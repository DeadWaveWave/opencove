import type { RunStateFence, RunStateReceipt } from './ports/PromptDeliveryPorts'

/** Authenticated submission evidence that has no authority to mutate run state. */
export class AgentSubmissionEvidence {
  private readonly listeners = new Map<string, Set<(receipt: RunStateReceipt) => void>>()
  watch(fence: RunStateFence, listener: (receipt: RunStateReceipt) => void): () => void {
    const id = fence.snapshot.sessionId
    const listeners = this.listeners.get(id) ?? new Set()
    this.listeners.set(id, listeners)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        this.listeners.delete(id)
      }
    }
  }
  emit(id: string, receipt: RunStateReceipt): void {
    for (const listener of [...(this.listeners.get(id) ?? [])]) {
      try {
        listener(structuredClone(receipt))
      } catch {
        /* A delivery consumer cannot change ingress authority. */
      }
    }
  }
  dispose(): void {
    this.listeners.clear()
  }
}
