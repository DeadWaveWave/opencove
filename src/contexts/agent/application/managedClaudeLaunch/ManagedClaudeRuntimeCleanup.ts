import type { ManagedClaudeLaunchPorts } from './ports'

/** Own exact runtime IDs until a definitive reference or successful kill resolves cleanup. */
export class ManagedClaudeRuntimeCleanup {
  private readonly pending = new Map<string, symbol>()
  private readonly inFlight = new Map<string, Promise<boolean>>()

  constructor(
    private readonly ports: Pick<
      ManagedClaudeLaunchPorts,
      'isRuntimeReferenced' | 'killExactRuntime'
    >,
    private readonly held: (id: string) => boolean,
  ) {}

  retain(id: string): void {
    this.pending.set(id, Symbol(id))
  }

  /** The claim covered by the next synchronous reference observation. */
  capture(id: string | null): symbol | undefined {
    return id === null ? undefined : this.pending.get(id)
  }

  confirmReferenced(id: string, claim: symbol | undefined): void {
    if (claim !== undefined && this.pending.get(id) === claim) {
      this.pending.delete(id)
    }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending.keys()].map(id => this.cleanup(id)))
  }

  cleanup(id: string): Promise<boolean> {
    this.retain(id)
    return this.cleanupRetained(id)
  }

  cleanupRetained(id: string): Promise<boolean> {
    const claim = this.pending.get(id)
    if (claim === undefined) {
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
          if (!referenced) {
            await this.ports.killExactRuntime(id)
          }
          if (this.pending.get(id) === claim) {
            this.pending.delete(id)
          }
          return !referenced
        } catch {
          // A failed read/kill retains the obligation for the next request or deletion event.
          return false
        }
      })
      .finally(() => {
        if (this.inFlight.get(id) === work) {
          this.inFlight.delete(id)
        }
      })
    this.inFlight.set(id, work)
    return work
  }
}
