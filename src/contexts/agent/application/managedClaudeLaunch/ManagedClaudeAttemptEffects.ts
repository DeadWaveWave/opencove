import type { ManagedClaudeLaunchAttempt } from './types'
import type { ManagedClaudeRuntimeCleanup } from './ManagedClaudeRuntimeCleanup'

/** Effect permission and runtime custody are separate from durable ownership. */
export class ManagedClaudeAttemptEffects {
  private readonly admissions = new WeakMap<ManagedClaudeLaunchAttempt, Promise<void>>()
  private readonly previous = new WeakMap<ManagedClaudeLaunchAttempt, Set<string>>()
  private readonly created = new WeakMap<ManagedClaudeLaunchAttempt, Set<string>>()
  private readonly retiring = new Map<string, Set<ManagedClaudeLaunchAttempt>>()

  constructor(private readonly cleanup: ManagedClaudeRuntimeCleanup) {}

  admitted(attempt: ManagedClaudeLaunchAttempt): boolean {
    return this.admissions.has(attempt)
  }

  admit(attempt: ManagedClaudeLaunchAttempt, effect: () => Promise<void>): Promise<void> {
    const existing = this.admissions.get(attempt)
    if (existing) {
      return existing
    }
    let resolve!: () => void, reject!: (error: unknown) => void
    const completion = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    this.admissions.set(attempt, completion)
    void effect().then(resolve, reject)
    return completion
  }

  retainPrevious(attempt: ManagedClaudeLaunchAttempt, id: string): void {
    const ids = this.previous.get(attempt) ?? new Set<string>()
    ids.add(id)
    this.previous.set(attempt, ids)
    this.cleanup.retain(id)
  }

  retainCreated(attempt: ManagedClaudeLaunchAttempt, id: string): void {
    const ids = this.created.get(attempt) ?? new Set<string>()
    ids.add(id)
    this.created.set(attempt, ids)
    this.cleanup.retain(id)
  }

  owns(attempt: ManagedClaudeLaunchAttempt, id: string): boolean {
    return (
      this.previous.get(attempt)?.has(id) === true || this.created.get(attempt)?.has(id) === true
    )
  }

  holdRetirement(attempt: ManagedClaudeLaunchAttempt, id: string): () => void {
    const holders = this.retiring.get(id) ?? new Set<ManagedClaudeLaunchAttempt>()
    holders.add(attempt)
    this.retiring.set(id, holders)
    return () => {
      holders.delete(attempt)
      if (!holders.size) {
        this.retiring.delete(id)
      }
    }
  }

  retirementHeld(id: string): boolean {
    return this.retiring.has(id)
  }

  renewPrevious(attempt: ManagedClaudeLaunchAttempt): void {
    for (const id of this.previous.get(attempt) ?? []) {
      this.cleanup.retain(id)
    }
  }

  releasePrevious(attempt: ManagedClaudeLaunchAttempt, id: string): void {
    this.previous.get(attempt)?.delete(id)
  }

  async cleanupPrevious(attempt: ManagedClaudeLaunchAttempt): Promise<void> {
    await Promise.all(
      [...(this.previous.get(attempt) ?? [])].map(id => this.cleanup.cleanupRetained(id)),
    )
  }

  async cleanupCreated(
    attempt: ManagedClaudeLaunchAttempt,
    processed?: string | null,
  ): Promise<void> {
    await Promise.all(
      [...(this.created.get(attempt) ?? [])]
        .filter(id => id !== processed)
        .map(id => this.cleanup.cleanupRetained(id)),
    )
  }
}
