import { PromptDeliveryEvidence } from './PromptDeliveryEvidence'
import {
  claudePromptDigest,
  claudePromptId,
} from '../../../shared/runtime/agentHook/claudePromptEvidence'
import { canonicalizePromptText } from '../domain/promptText'
import { createAppError } from '../../../shared/errors/appError'
import type { AgentPromptErrorDetails, AppErrorCode } from '../../../shared/contracts/dto/error'
import type {
  PromptDeliveryPorts,
  PromptDeliveryCaller,
  RunStateFence,
  RunStateReceipt,
} from './ports/PromptDeliveryPorts'
import { promptAdmission, samePromptEntry } from './promptAdmission'
import { PromptDeliveryRecords } from './PromptDeliveryRecords'
export type { AgentPromptResult as PromptDeliveryResult } from '../../../shared/contracts/dto/agentPrompt'
import type { AgentPromptResult as PromptDeliveryResult } from '../../../shared/contracts/dto/agentPrompt'

export interface PromptDeliveryRequest {
  nodeId?: string
  sessionId?: string
  text: string
  timeoutMs: number
  whenBusy?: 'steer' | 'refuse'
  expectTurnId?: string
  deliveryId?: string
}
/** Attempt lifetime is independent of the HTTP waiter after CR. Never retries input. */
export class PromptDeliveryService {
  private disposed = false
  private readonly cancellations = new Set<() => void>()
  private readonly records: PromptDeliveryRecords
  constructor(private readonly ports: PromptDeliveryPorts) {
    this.records = new PromptDeliveryRecords(ports.now)
  }
  get(id: string) {
    return this.records.get(id)
  }

  forTurn(sessionId: string, turnId: string): string[] {
    return this.records.forTurn(sessionId, turnId)
  }

  deliver(
    request: PromptDeliveryRequest,
    caller: PromptDeliveryCaller = {},
  ): Promise<PromptDeliveryResult> {
    const text = canonicalizePromptText(request.text)
    const expectedDigest = claudePromptDigest(text)
    const deadline = this.ports.now() + request.timeoutMs
    const locator = request.nodeId ? { nodeId: request.nodeId } : { sessionId: request.sessionId! }
    const initial = this.ports.runs.readFence(locator)
    if (initial) {
      caller.authorizePrompt?.(initial.snapshot.provider, text)
    }
    const id = request.deliveryId ?? this.ports.createDeliveryId()
    const error = (
      code: AppErrorCode,
      reason: string,
      paste = false,
      submit = false,
      deliveryId = id,
    ) => {
      const details: AgentPromptErrorDetails = {
        reason,
        pasteDispatchAttempted: paste,
        submitDispatchAttempted: submit,
        retryable: !paste && reason !== 'history_saturated',
        deliveryId,
        ...(reason === 'expected_turn_mismatch'
          ? {
              expectedTurnId: request.expectTurnId,
              currentState: this.ports.runs.readFence(locator)?.snapshot ?? null,
            }
          : {}),
        ...(code === 'agent.blocked'
          ? { blockedReason: this.ports.runs.readFence(locator)?.snapshot.blockedReason ?? null }
          : {}),
      }
      return createAppError(code, { details })
    }
    if (this.disposed) {
      return Promise.reject(error('agent.not_running', 'shutdown'))
    }
    const expected = (f: RunStateFence | null) =>
      !request.expectTurnId ||
      (f?.snapshot.state === 'working' && f.snapshot.turn?.id === request.expectTurnId)
    if (!initial?.claudeHistorySaturated && !expected(initial)) {
      return Promise.reject(error('agent.busy', 'expected_turn_mismatch'))
    }
    const refusal = promptAdmission(initial, this.ports.capability, request.whenBusy)
    if (refusal) {
      return Promise.reject(error(refusal.code, refusal.reason))
    }
    const admitted = initial!
    const initialIdentity = this.ports.runs.promptIdentity?.(admitted)
    const blocking = this.records.blocking(admitted)
    if (blocking) {
      return Promise.reject(
        error(
          request.whenBusy ? 'agent.delivery_unsettled' : 'agent.busy',
          'delivery_in_progress',
          false,
          false,
          blocking.dto.deliveryId,
        ),
      )
    }
    if (request.deliveryId && this.records.records.has(id)) {
      return Promise.reject(error('common.invalid_input', 'delivery_id_reused'))
    }
    const record = this.records.allocate(
      id,
      admitted,
      admitted.snapshot.state === 'working' ? 'steer' : 'turn',
    )
    if (!record) {
      return Promise.reject(
        error(
          request.whenBusy ? 'agent.delivery_unsettled' : 'agent.busy',
          request.whenBusy ? 'delivery_capacity' : 'delivery_in_progress',
        ),
      )
    }
    return new Promise<PromptDeliveryResult>((resolve, reject) => {
      let settled = false,
        paste = false,
        submit = false,
        latched = false
      const evidence = new PromptDeliveryEvidence(request.whenBusy !== undefined)
      let otherInput = false
      let receiptDeadline = Infinity
      const waiterCleanups: (() => void)[] = []
      const cleanup = (stop: () => void) => (settled ? stop() : waiterCleanups.push(stop))
      const finish = (failure?: unknown, result?: PromptDeliveryResult) => {
        if (settled) {
          return
        }
        settled = true
        waiterCleanups.splice(0).forEach(stop => stop())
        this.cancellations.delete(cancel)
        if (failure) {
          reject(failure)
        } else {
          resolve(result!)
        }
      }
      const closeEvidenceWindow = () => {
        record.dto.evidenceWindow = 'closed'
      }
      const fail = (
        reason: string,
        code?: AppErrorCode,
        uncertainWrite = false,
        deliveryId = id,
      ) => {
        latched = true
        if (record.dto.status !== 'submitted') {
          if (submit) {
            if (!record.codexSteer || uncertainWrite) {
              record.dto.status = 'unknown'
            }
          } else {
            this.records.settle(record, 'not_sent')
          }
          if (!submit) {
            record.dto.evidence = { kind: 'no_enter', at: this.ports.now() }
          }
        }
        closeEvidenceWindow()
        if (!submit || (record.codexSteer && uncertainWrite)) {
          this.records.stopReconciliation(record)
        }
        finish(
          error(
            code ??
              (submit
                ? 'agent.prompt_stalled'
                : paste
                  ? 'agent.prompt_interrupted'
                  : reason === 'deadline'
                    ? 'agent.prompt_timeout'
                    : 'agent.not_running'),
            reason,
            paste,
            submit,
            deliveryId,
          ),
        )
      }
      const cancel = () => fail('shutdown')
      this.cancellations.add(cancel)
      const active = () => {
        if (settled) {
          return false
        }
        if (this.ports.now() >= deadline) {
          fail('deadline')
          return false
        }
        try {
          caller.assertActive?.()
          if (caller.signal?.aborted) {
            throw new Error('revoked')
          }
        } catch {
          fail('caller_revoked')
          return false
        }
        return true
      }
      const onAbort = () => fail('caller_revoked')
      caller.signal?.addEventListener('abort', onAbort, { once: true })
      cleanup(() => caller.signal?.removeEventListener('abort', onAbort))
      cleanup(this.ports.schedule(() => fail('deadline'), Math.max(0, deadline - this.ports.now())))
      const inputAdmitted = (fence: RunStateFence) => {
        const blocker = this.records.blocking(fence, record)
        if (!blocker && !otherInput) {
          return true
        }
        fail(
          blocker ? 'delivery_in_progress' : 'competing_input',
          paste
            ? undefined
            : blocker && request.whenBusy
              ? 'agent.delivery_unsettled'
              : 'agent.busy',
          false,
          blocker?.dto.deliveryId,
        )
        return false
      }
      const result = (
        phase: PromptDeliveryResult['phase'],
        r?: RunStateReceipt,
      ): PromptDeliveryResult => ({
        deliveryId: id,
        nodeId: admitted.snapshot.nodeId,
        sessionId: admitted.snapshot.sessionId,
        phase,
        ...(request.whenBusy ? { mode: record.dto.mode } : {}),
        turnId: record.dto.turnId!,
        textComparison:
          r &&
          admitted.snapshot.provider === 'claude-code' &&
          typeof r.promptDigest === 'string' &&
          /^[a-f0-9]{64}$/.test(r.promptDigest)
            ? r.promptDigest === expectedDigest
              ? 'matched'
              : 'different'
            : 'unavailable',
        ...(admitted.snapshot.provider === 'claude-code'
          ? { comparisonProfile: 'claude-code-v1' as const, promptId: claudePromptId(r?.promptId) }
          : {}),
      })
      const safe = (f: RunStateFence | null) => {
        if (
          !expected(f) ||
          !samePromptEntry(admitted, f) ||
          promptAdmission(f, this.ports.capability, request.whenBusy)
        ) {
          return false
        }
        const turn = admitted.snapshot.turn?.id
        return !f.snapshot.turn || (turn !== undefined && f.snapshot.turn.id === turn)
      }
      const receipt = (r: RunStateReceipt) => {
        if (!submit) {
          if (!safe(r.fence)) {
            const observedRefusal = promptAdmission(
              r.fence,
              this.ports.capability,
              request.whenBusy,
            )
            fail(
              expected(r.fence)
                ? (observedRefusal?.reason ?? 'observation_received')
                : 'expected_turn_mismatch',
              paste ? undefined : !expected(r.fence) ? 'agent.busy' : observedRefusal?.code,
            )
          } else if (!samePromptEntry(admitted, r.fence)) {
            fail('binding_changed')
          }
          return
        }
        // The waiter can expire; passive evidence still upgrades its retained record.
        if (!settled && (!active() || this.ports.now() >= receiptDeadline)) {
          if (!settled) {
            fail('receipt_deadline')
          }
          // Do not resolve an overdue waiter, but continue evidence reconciliation.
        }
        const conversationChanged =
          r.fence !== null && r.fence.conversationGeneration !== admitted.conversationGeneration
        if (!samePromptEntry(admitted, r.fence)) {
          record.retired = conversationChanged
          if (record.retired) {
            record.resolvedAt ??= this.ports.now()
          }
          this.records.stopReconciliation(record)
          if (record.dto.status !== 'submitted') {
            record.dto.status = 'unknown'
          }
          closeEvidenceWindow()
          if (!settled) {
            fail('binding_changed')
          }
          return
        }
        if (record.codexSteer && r.fence.snapshot.turn?.id !== record.dto.turnId) {
          if (record.dto.status === 'dispatched') {
            record.dto.status = 'unknown'
            record.dto.evidence = { kind: 'turn_end', at: this.ports.now() }
            this.records.stopReconciliation(record)
          }
        }
        const qualified = evidence.qualify(r, record, this.ports.now())
        if (
          !qualified ||
          (record.codexSteer && !this.records.claimCodex(record, r.sourceSequence ?? 0))
        ) {
          return
        }
        r = qualified
        if (record.dto.status === 'submitted' || record.dto.status === 'not_sent') {
          return
        }
        record.dto.turnId ??= r.turnId
        const output = result('submission_observed', r)
        this.records.settle(record, 'submitted')
        record.dto.evidence = { kind: 'hook', at: this.ports.now() }
        record.dto.textComparison = output.textComparison
        record.dto.comparisonProfile = output.comparisonProfile
        record.dto.promptId = output.promptId
        closeEvidenceWindow()
        this.records.stopReconciliation(record)
        finish(undefined, output)
      }
      this.records.keepCleanup(record, this.ports.runs.watchFence(admitted, receipt))
      this.records.keepCleanup(
        record,
        this.ports.runs.watchSubmissionEvidence?.(admitted, receipt) ?? (() => {}),
      )
      this.records.keepCleanup(
        record,
        this.ports.input.watchInput?.(admitted.snapshot.sessionId, (writer, data) => {
          if (writer === id) {
            return
          }
          const own = writer ? this.records.records.get(writer) : undefined
          if (own?.codexSteer && own.dto.incarnation === record.dto.incarnation) {
            return
          }
          if (!submit) {
            otherInput = true
            return
          }
          if (!record.codexSteer || record.dto.status !== 'dispatched') {
            return
          }
          record.dto.status = data?.includes('\x03') || data === '\x1b' ? 'unknown' : 'ambiguous'
          record.dto.evidence = { kind: 'other_input', at: this.ports.now() }
          this.records.stopReconciliation(record)
        }) ?? (() => {}),
      )
      const stopInputWatch = this.ports.input.watchInputInvalidation(
        admitted.snapshot.sessionId,
        () => {
          if (!submit) {
            fail('capability_lost')
          }
        },
      )
      cleanup(stopInputWatch)
      void this.ports.input
        .withSessionInputOperation(admitted.snapshot.sessionId, async input => {
          if (!active()) {
            return
          }
          const current = this.ports.runs.readFence(locator)
          if (!samePromptEntry(admitted, current) || !input.isLive()) {
            fail('binding_changed')
            return
          }
          if (!current?.claudeHistorySaturated && !expected(current)) {
            fail('expected_turn_mismatch', 'agent.busy')
            return
          }
          if (!inputAdmitted(current)) {
            return
          }
          const refused = promptAdmission(current, this.ports.capability, request.whenBusy)
          if (refused) {
            fail(refused.reason, refused.code)
            return
          }
          if (!input.mode().bracketedPaste) {
            fail('bracketed_paste_off', 'agent.prompt_unsupported')
            return
          }
          if (!safe(current)) {
            fail('capability_lost')
            return
          }
          paste = true
          input.write(`\x1b[200~${text}\x1b[201~`, id)
          await new Promise<void>(wake => {
            const stop = this.ports.schedule(
              wake,
              this.ports.capability(admitted.snapshot.provider)!.submitDelayMs,
            )
            cleanup(() => {
              stop()
              wake()
            })
          })
          if (!active() || latched) {
            return
          }
          const fresh = this.ports.runs.readFence(locator)
          if (!expected(fresh)) {
            fail('expected_turn_mismatch')
            return
          }
          if (!inputAdmitted(admitted)) {
            return
          }
          if (!safe(fresh) || !input.isLive() || !input.mode().bracketedPaste) {
            fail('capability_lost')
            return
          }
          // No await between full admission/identity check, source watermark and CR.
          evidence.capture(fresh!, this.ports.runs.promptIdentity?.(fresh!) ?? initialIdentity)
          record.dto.mode = fresh!.snapshot.state === 'working' ? 'steer' : 'turn'
          record.dto.turnId = fresh!.snapshot.turn?.id
          record.codexSteer = record.dto.mode === 'steer' && admitted.snapshot.provider === 'codex'
          submit = true
          record.submitAt = this.ports.now()
          record.dto.dispatchedAt = record.submitAt
          if (record.codexSteer) {
            record.dto.status = 'dispatched'
          }
          receiptDeadline = Math.min(deadline, record.submitAt + 5000)
          try {
            input.write('\r', id, evidence.inputTarget)
          } catch (cause) {
            fail(cause instanceof Error ? cause.message : 'write_failed', undefined, true)
            return
          } finally {
            stopInputWatch()
          }
          if (record.codexSteer) {
            finish(undefined, result('dispatched'))
          } else if (!settled) {
            cleanup(
              this.ports.schedule(
                () => fail(this.ports.now() >= deadline ? 'deadline' : 'receipt_deadline'),
                Math.max(0, receiptDeadline - this.ports.now()),
              ),
            )
          }
          if (record.dto.status !== 'submitted') {
            this.records.keepCleanup(
              record,
              this.ports.schedule(() => {
                closeEvidenceWindow()
                if (record.dto.status === 'pending') {
                  record.dto.status = 'unknown'
                }
              }, 120_000),
            )
          }
        })
        .catch(cause =>
          fail(cause instanceof Error ? cause.message : 'write_failed', undefined, submit),
        )
    })
  }
  dispose(): void {
    this.disposed = true
    for (const cancel of [...this.cancellations]) {
      cancel()
    }
    this.records.dispose()
  }
}
