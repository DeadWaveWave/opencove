import {
  claudePromptDigest,
  claudePromptId,
} from '../../../shared/runtime/agentHook/claudePromptEvidence'
import { canonicalizePromptText } from '../domain/promptText'
import { createAppError } from '../../../shared/errors/appError'
import type { AgentPromptErrorDetails, AppErrorCode } from '../../../shared/contracts/dto/error'
import type {
  PromptDeliveryPorts,
  RunStateFence,
  RunStateReceipt,
} from './ports/PromptDeliveryPorts'
import { promptAdmission, promptHookSource, samePromptEntry } from './promptAdmission'

export interface PromptDeliveryRequest {
  nodeId?: string
  sessionId?: string
  text: string
  timeoutMs: number
}
export type { AgentPromptResult as PromptDeliveryResult } from '../../../shared/contracts/dto/agentPrompt'
import type { AgentPromptResult as PromptDeliveryResult } from '../../../shared/contracts/dto/agentPrompt'
/** Volatile delivery intent owner. No retries, renderer state, transport, or PTY dependencies. */
export class PromptDeliveryService {
  private disposed = false
  private readonly reservations = new Set<string>()
  private readonly cancellations = new Set<() => void>()
  constructor(private readonly ports: PromptDeliveryPorts) {}

  deliver(
    request: PromptDeliveryRequest,
    caller: { assertActive?: () => void; signal?: AbortSignal } = {},
  ): Promise<PromptDeliveryResult> {
    const text = canonicalizePromptText(request.text)
    const expectedDigest = claudePromptDigest(text)
    const deadline = this.ports.now() + request.timeoutMs
    const locator = request.nodeId ? { nodeId: request.nodeId } : { sessionId: request.sessionId! }
    const initial = this.ports.runs.readFence(locator)
    const refusal = promptAdmission(initial, this.ports.capability)
    const error = (code: AppErrorCode, reason: string, paste = false, submit = false) => {
      const details: AgentPromptErrorDetails = {
        reason,
        pasteDispatchAttempted: paste,
        submitDispatchAttempted: submit,
        retryable: !paste,
        ...(code === 'agent.blocked'
          ? { blockedReason: this.ports.runs.readFence(locator)?.snapshot.blockedReason ?? null }
          : {}),
      }
      return createAppError(code, { details })
    }
    if (this.disposed) {
      return Promise.reject(error('agent.not_running', 'shutdown'))
    }
    if (refusal) {
      return Promise.reject(error(refusal.code, refusal.reason))
    }
    const admitted = initial!
    const key = `${admitted.epoch}:${admitted.incarnation}`
    if (this.reservations.has(key)) {
      return Promise.reject(error('agent.busy', 'delivery_in_progress'))
    }
    this.reservations.add(key)
    return new Promise<PromptDeliveryResult>((resolve, reject) => {
      let settled = false,
        paste = false,
        submit = false,
        latched = false
      let submitAt = Infinity,
        receiptDeadline = Infinity
      let submitFence: RunStateFence | undefined
      const cleanups: (() => void)[] = []
      const cleanup = (dispose: () => void) => {
        if (settled) {
          dispose()
        } else {
          cleanups.push(dispose)
        }
      }
      const finish = (failure?: unknown, result?: PromptDeliveryResult) => {
        if (settled) {
          return
        }
        settled = true
        for (const dispose of cleanups) {
          dispose()
        }
        this.reservations.delete(key)
        this.cancellations.delete(cancel)
        if (failure) {
          reject(failure)
        } else {
          resolve(result!)
        }
      }
      const fail = (reason: string) => {
        latched = true
        finish(
          error(
            submit
              ? 'agent.prompt_stalled'
              : paste
                ? 'agent.prompt_interrupted'
                : reason === 'deadline'
                  ? 'agent.prompt_timeout'
                  : 'agent.not_running',
            reason,
            paste,
            submit,
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
            throw new Error('Caller revoked')
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
      const receipt = (r: RunStateReceipt) => {
        if (settled) {
          return
        }
        if (!active()) {
          return
        }
        if (submit && this.ports.now() >= receiptDeadline) {
          fail('receipt_deadline')
          return
        }
        if (!samePromptEntry(admitted, r.fence)) {
          fail('binding_changed')
          return
        }
        if (!submit) {
          if (paste) {
            latched = true
            fail('observation_received')
          }
          return
        }
        if (
          r.emittedAtMs !== undefined &&
          Number.isFinite(r.emittedAtMs) &&
          r.emittedAtMs >= submitAt &&
          r.source === promptHookSource(admitted.snapshot.provider) &&
          r.hookEventName === 'UserPromptSubmit' &&
          (r.sourceSequence ?? 0) >
            (submitFence?.watermarks[promptHookSource(admitted.snapshot.provider)] ?? 0) &&
          r.turnId &&
          r.fence.snapshot.source === promptHookSource(admitted.snapshot.provider) &&
          r.fence.snapshot.quality !== 'degraded'
        ) {
          finish(undefined, {
            deliveryId: this.ports.createDeliveryId(),
            nodeId: admitted.snapshot.nodeId,
            sessionId: admitted.snapshot.sessionId,
            phase: 'submission_observed',
            turnId: r.turnId,
            textComparison:
              admitted.snapshot.provider !== 'claude-code' ||
              typeof r.promptDigest !== 'string' ||
              !/^[a-f0-9]{64}$/.test(r.promptDigest)
                ? 'unavailable'
                : r.promptDigest === expectedDigest
                  ? 'matched'
                  : 'different',
            ...(admitted.snapshot.provider === 'claude-code'
              ? {
                  comparisonProfile: 'claude-code-v1' as const,
                  promptId: claudePromptId(r.promptId),
                }
              : {}),
          })
        }
      }
      // Watch before enqueue: replacement and caller cancellation must release a queued reservation.
      cleanup(this.ports.runs.watchFence(admitted, receipt))
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
          const refused = promptAdmission(current, this.ports.capability)
          if (refused) {
            finish(error(refused.code, refused.reason))
            return
          }
          if (!input.mode().bracketedPaste) {
            finish(error('agent.prompt_unsupported', 'bracketed_paste_off'))
            return
          }
          if (!active()) {
            return
          }
          const stopInputWatch = input.watchInvalidation(() => fail('capability_lost'))
          cleanup(stopInputWatch)
          paste = true
          input.write(`\x1b[200~${text}\x1b[201~`)
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
          if (
            !samePromptEntry(admitted, fresh) ||
            !input.isLive() ||
            !input.mode().bracketedPaste ||
            promptAdmission(fresh, this.ports.capability)
          ) {
            fail('capability_lost')
            return
          }
          // No await between the source fence and Enter. Synchronous receipts during write are visible.
          submitFence = fresh
          if (!active()) {
            return
          }
          submit = true
          stopInputWatch()
          submitAt = this.ports.now()
          receiptDeadline = Math.min(deadline, submitAt + 5000)
          input.write('\r')
          if (!settled) {
            cleanup(
              this.ports.schedule(
                () => fail(this.ports.now() >= deadline ? 'deadline' : 'receipt_deadline'),
                Math.max(0, receiptDeadline - this.ports.now()),
              ),
            )
          }
        })
        .catch(cause =>
          finish(
            error(
              paste
                ? submit
                  ? 'agent.prompt_stalled'
                  : 'agent.prompt_interrupted'
                : 'agent.not_running',
              cause instanceof Error ? cause.message : 'write_failed',
              paste,
              submit,
            ),
          ),
        )
    })
  }
  dispose(): void {
    this.disposed = true
    for (const cancel of [...this.cancellations]) {
      cancel()
    }
  }
}
