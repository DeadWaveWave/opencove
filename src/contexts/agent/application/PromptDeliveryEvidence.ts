import { claudePromptId } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { DeliveryRecord } from './PromptDeliveryRecords'
import type {
  PromptDeliveryIdentity,
  RunStateFence,
  RunStateReceipt,
} from './ports/PromptDeliveryPorts'
import { promptHookSource } from './promptAdmission'

/** Private isolation fence: historical mappings cannot authorize a fresh delivery. */
export class PromptDeliveryEvidence {
  private fence?: RunStateFence
  private identity?: PromptDeliveryIdentity
  private ended = new Set<string>()
  private postFence?: { turnId: string; promptId?: string; providerSessionId?: string }
  constructor(private readonly negotiated: boolean) {}
  capture(fence: RunStateFence, identity?: PromptDeliveryIdentity): void {
    this.fence = fence
    this.identity = identity
    this.ended = new Set(identity?.endedTurnIds)
    if (fence.snapshot.lastEndedTurn) {
      this.ended.add(fence.snapshot.lastEndedTurn.id)
    }
  }
  qualify(r: RunStateReceipt, record: DeliveryRecord, now: number): RunStateReceipt | undefined {
    const provider = record.initial.snapshot.provider
    const hook = promptHookSource(provider)
    if (
      !this.fence ||
      r.source !== hook ||
      r.hookEventName !== 'UserPromptSubmit' ||
      (r.sourceSequence ?? 0) <= (this.fence.watermarks[hook] ?? 0) ||
      (r.turnId && this.ended.has(r.turnId))
    ) {
      return
    }
    const identity = this.identity
    if (provider === 'claude-code') {
      if (this.negotiated && !claudePromptId(r.promptId)) {
        return
      }
      if (identity?.providerSessionId && identity.providerSessionId !== r.providerSessionId) {
        return
      }
      if (
        record.dto.mode === 'steer' &&
        (!identity?.promptId || r.promptId !== identity.promptId)
      ) {
        return
      }
      if (record.dto.mode === 'turn' && identity?.promptId && identity.promptId === r.promptId) {
        return
      }
    } else if (record.codexSteer) {
      if (
        (identity?.providerSessionId &&
          r.providerSessionId &&
          identity.providerSessionId !== r.providerSessionId) ||
        (identity?.providerTurnId &&
          r.providerTurnId &&
          identity.providerTurnId !== r.providerTurnId) ||
        r.turnId !== record.dto.turnId
      ) {
        return
      }
    }
    // A post-fence start without a usable timestamp does not confirm submission, but
    // its private identity can correlate a genuinely late hook after that turn ends.
    if (r.turnId && record.dto.mode === 'turn') {
      this.postFence = {
        turnId: r.turnId,
        promptId: r.promptId,
        providerSessionId: r.providerSessionId,
      }
    }
    const turnId =
      r.turnId ??
      (r.promptId &&
      r.promptId === this.postFence?.promptId &&
      r.providerSessionId === this.postFence.providerSessionId
        ? this.postFence.turnId
        : undefined)
    const stamp = r.emittedAtMs
    if (
      stamp === undefined ||
      !Number.isFinite(stamp) ||
      stamp < record.submitAt ||
      stamp < now - 60_000 ||
      stamp > now + 2000
    ) {
      return
    }
    if (
      record.dto.mode === 'turn' &&
      (!turnId || r.fence?.snapshot.source !== hook || r.fence.snapshot.quality === 'degraded')
    ) {
      return
    }
    return { ...r, turnId }
  }
}
