import type { ManagedClaudeLaunchPorts } from './ports'
import type { ManagedClaudeRuntimeCleanup } from './ManagedClaudeRuntimeCleanup'

/** A returned shell is held until durable reference proof, deletion or confirmed replacement. */
export class ManagedClaudeFallbackCustody {
  private readonly nodes = new Map<string, { nodeId: string; predecessors: readonly string[] }>()
  private readonly retries = new Map<string, () => void>()
  constructor(
    private readonly cleanup: ManagedClaudeRuntimeCleanup,
    private readonly ports: Pick<
      ManagedClaudeLaunchPorts,
      'isRuntimeReferenced' | 'scheduleReconciliation'
    >,
  ) {}

  held(id: string): boolean {
    return (
      this.nodes.has(id) || [...this.nodes.values()].some(value => value.predecessors.includes(id))
    )
  }

  ids(nodeId: string): string[] {
    return [...this.nodes].filter(([, node]) => node.nodeId === nodeId).map(([id]) => id)
  }

  retain(nodeId: string, id: string, predecessors: readonly string[]): void {
    this.cleanup.retain(id, nodeId)
    this.nodes.set(id, { nodeId, predecessors })
    for (const previous of predecessors) {
      this.cleanup.retain(previous, nodeId)
    }
  }

  release(ids: readonly string[]): void {
    for (const id of ids) {
      this.nodes.delete(id)
      this.retries.get(id)?.()
      this.retries.delete(id)
    }
  }

  observeReferences(): void {
    for (const id of this.nodes.keys()) {
      this.confirm(id)
    }
  }

  private confirm(id: string): void {
    const claim = this.cleanup.capture(id)
    const custody = this.nodes.get(id)
    try {
      if (this.ports.isRuntimeReferenced(id)) {
        this.release([id])
        if (!this.held(id)) {
          this.cleanup.confirmReferenced(id, claim)
        }
        // A fallback replaces its predecessors only when its node association is durable.
        for (const previous of custody?.predecessors ?? []) {
          this.release([previous])
          void this.cleanup.cleanupRetained(previous)
        }
      }
    } catch {
      if (this.retries.has(id) || !this.ports.scheduleReconciliation) {
        return
      }
      const cancel = this.ports.scheduleReconciliation(() => {
        if (this.retries.get(id) !== cancel) {
          return
        }
        this.retries.delete(id)
        if (this.nodes.has(id)) {
          this.confirm(id)
        }
      }, 1000)
      this.retries.set(id, cancel)
    }
  }

  dispose(): void {
    this.release([...this.nodes.keys()])
  }
}
