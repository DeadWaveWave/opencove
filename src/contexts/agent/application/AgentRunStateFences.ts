import type { PromptSubmissionEvidence } from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { AgentRunObservation } from '../domain/agentRunState'
import type { RunStateFence, RunStateReceipt } from './ports/PromptDeliveryPorts'

/** Internal accepted-receipt stream, independent of public snapshot transitions. */
export class AgentRunStateFences {
  private readonly listeners = new Map<string, Set<(receipt: RunStateReceipt) => void>>()
  private readonly history = new Map<string, RunStateReceipt[]>()
  private readonly queue: { id: string; receipt: RunStateReceipt }[] = []
  private delivering = false
  private cursor = 0
  nextCursor(): number {
    return ++this.cursor
  }
  watch(
    fence: RunStateFence,
    read: () => RunStateFence | null,
    listener: (receipt: RunStateReceipt) => void,
  ): () => void {
    const id = fence.snapshot.sessionId
    let active = true,
      replaying = true,
      cursor = fence.cursor
    const buffered: RunStateReceipt[] = []
    const deliver = (receipt: RunStateReceipt) => {
      if (!active || (receipt.fence && receipt.fence.cursor <= cursor)) {
        return
      }
      if (receipt.fence) {
        cursor = receipt.fence.cursor
      }
      listener(structuredClone(receipt))
    }
    const receive = (receipt: RunStateReceipt) => {
      if (replaying) {
        buffered.push(receipt)
      } else {
        deliver(receipt)
      }
    }
    const listeners = this.listeners.get(id) ?? new Set()
    this.listeners.set(id, listeners)
    listeners.add(receive)
    const current = read()
    const history = this.history.get(id) ?? []
    if (
      !current ||
      current.incarnation !== fence.incarnation ||
      (current.cursor !== cursor &&
        (!history.length || (history[0].fence?.cursor ?? Infinity) > cursor))
    ) {
      listener({ fence: current })
    } else {
      for (const receipt of [...history]) {
        deliver(receipt)
      }
    }
    replaying = false
    for (const receipt of buffered) {
      deliver(receipt)
    }
    return () => {
      active = false
      listeners.delete(receive)
      if (!listeners.size) {
        this.listeners.delete(id)
      }
    }
  }
  emit(id: string, receipt: RunStateReceipt): void {
    const frozen = structuredClone(receipt)
    const history = this.history.get(id) ?? []
    history.push(frozen)
    if (history.length > 1024) {
      history.shift()
    }
    if (receipt.fence) {
      this.history.set(id, history)
    } else {
      this.history.delete(id)
    }
    this.queue.push({ id, receipt: frozen })
    if (this.delivering) {
      return
    }
    this.delivering = true
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!
        for (const listener of [...(this.listeners.get(next.id) ?? [])]) {
          try {
            listener(structuredClone(next.receipt))
          } catch {
            /* A consumer cannot block ingress or other consumers. */
          }
        }
      }
    } finally {
      this.delivering = false
    }
  }
  dispose(): void {
    for (const id of this.listeners.keys()) {
      this.emit(id, { fence: null })
    }
    this.listeners.clear()
    this.history.clear()
  }
}

/** Called only after the reducer accepts an observation; content never enters its model. */
export function acceptedRunStateReceipt(
  observation: AgentRunObservation,
  turnId: string | undefined,
  evidence?: PromptSubmissionEvidence,
): Omit<RunStateReceipt, 'fence'> {
  return {
    source: observation.source,
    hookEventName: observation.hookEventName,
    emittedAtMs: observation.emittedAtMs,
    sourceSequence: observation.sourceSequence,
    turnId,
    ...(observation.source === 'claude_hook' && observation.hookEventName === 'UserPromptSubmit'
      ? { promptId: evidence?.promptId, promptDigest: evidence?.promptDigest }
      : {}),
  }
}
