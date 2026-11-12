import type { ManagedClaudeLaunchPorts } from './ports'

/** Own exact runtime IDs until a definitive reference or successful kill resolves cleanup. */
export class ManagedClaudeRuntimeCleanup {
  private readonly pending = new Map<string, { claim: symbol; nodes: Set<string> }>()
  private readonly inFlight = new Map<string, Promise<boolean>>()
  // Runtime IDs are never reused within a Worker. Keep terminal proof across later claims.
  private readonly terminated = new Set<string>()
  private readonly retries = new Map<string, () => void>()
  private readonly failed = new Set<string>()
  private disposed = false

  constructor(
    private readonly ports: Pick<
      ManagedClaudeLaunchPorts,
      'isRuntimeReferenced' | 'killExactRuntime' | 'scheduleReconciliation'
    >,
    private readonly held: (id: string) => boolean,
  ) {}

  dispose(): void {
    this.disposed = true
    for (const cancel of this.retries.values()) {
      cancel()
    }
    this.retries.clear()
  }

  private clearRetry(id: string): void {
    this.failed.delete(id)
    this.retries.get(id)?.()
    this.retries.delete(id)
  }

  private retry(id: string): void {
    if (this.disposed || this.retries.has(id) || !this.ports.scheduleReconciliation) {
      return
    }
    const cancel = this.ports.scheduleReconciliation(() => {
      if (this.retries.get(id) !== cancel || this.disposed) {
        return
      }
      this.retries.delete(id)
      void this.cleanupRetained(id)
    }, 1000)
    this.retries.set(id, cancel)
  }

  retain(id: string, nodeId?: string): void {
    const nodes = this.pending.get(id)?.nodes ?? new Set<string>()
    if (nodeId) {
      nodes.add(nodeId)
    }
    this.pending.set(id, { claim: Symbol(id), nodes })
  }

  pendingRuntimeIds(nodeId?: string): readonly string[] {
    return [...this.pending]
      .filter(([, claim]) => nodeId === undefined || claim.nodes.has(nodeId))
      .map(([id]) => id)
  }

  /** The claim covered by the next synchronous reference observation. */
  capture(id: string | null): symbol | undefined {
    return id === null ? undefined : this.pending.get(id)?.claim
  }

  confirmReferenced(id: string, claim: symbol | undefined): void {
    if (claim !== undefined && this.pending.get(id)?.claim === claim) {
      this.pending.delete(id)
      this.clearRetry(id)
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map(id => this.cleanup(id)))
  }

  cleanup(id: string): Promise<boolean> {
    this.retain(id)
    return this.cleanupRetained(id)
  }

  cleanupRetained(id: string, retryFailed = true): Promise<boolean> {
    const claim = this.capture(id)
    if (claim === undefined) {
      return Promise.resolve(false)
    }
    if (!retryFailed && this.failed.has(id)) {
      return Promise.resolve(false)
    }
    const existing = this.inFlight.get(id)
    if (existing) {
      return existing
    }
    if (this.held(id)) {
      return Promise.resolve(false)
    }
    // Install the shared work before invoking an async kill or a reentrant port.
    const work: Promise<boolean> = Promise.resolve()
      .then(async () => {
        if (this.held(id)) {
          return false
        }
        try {
          const referenced = this.ports.isRuntimeReferenced(id)
          if (!referenced && !this.terminated.has(id)) {
            await this.ports.killExactRuntime(id)
            // Successful termination remains true even when a later claim needs a new read.
            this.terminated.add(id)
          }
          if (this.pending.get(id)?.claim === claim) {
            this.pending.delete(id)
            this.clearRetry(id)
          }
          return !referenced
        } catch {
          this.failed.add(id)
          this.retry(id)
          return false
        }
      })
      .finally(() => {
        if (this.inFlight.get(id) === work) {
          this.inFlight.delete(id)
        }
        if (this.pending.has(id) && !this.held(id)) {
          this.retry(id)
        }
      })
    this.inFlight.set(id, work)
    return work
  }
}
