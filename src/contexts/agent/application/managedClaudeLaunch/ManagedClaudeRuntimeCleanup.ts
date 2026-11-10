import type { ManagedClaudeLaunchPorts } from './ports'

/** Own exact runtime IDs until a definitive reference or successful kill resolves cleanup. */
export class ManagedClaudeRuntimeCleanup {
  private readonly pending = new Set<string>()
  private readonly inFlight = new Map<string, Promise<boolean>>()

  constructor(
    private readonly ports: Pick<
      ManagedClaudeLaunchPorts,
      'isRuntimeReferenced' | 'killExactRuntime'
    >,
    private readonly held: (id: string) => boolean,
  ) {}

  retain(id: string): void {
    this.pending.add(id)
  }

  confirmReferenced(id: string): void {
    this.pending.delete(id)
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending].map(id => this.cleanup(id)))
  }

  cleanup(id: string): Promise<boolean> {
    this.retain(id)
    return this.cleanupRetained(id)
  }

  cleanupRetained(id: string): Promise<boolean> {
    if (!this.pending.has(id)) {
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
    const work = Promise.resolve()
      .then(async () => {
        if (this.held(id)) {
          return false
        }
        try {
          const referenced = this.ports.isRuntimeReferenced(id)
          if (!referenced) {
            await this.ports.killExactRuntime(id)
          }
          this.pending.delete(id)
          return !referenced
        } catch {
          // A failed read/kill retains the obligation for the next request or deletion event.
          return false
        }
      })
      .finally(() => {
        this.inFlight.delete(id)
      })
    this.inFlight.set(id, work)
    return work
  }
}
