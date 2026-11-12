import type { SessionStateWatcherStartInput } from './sessionStateWatcherInput'

/** First-read eligibility belongs to the invocation, not to a watcher attachment. */
export class SessionFileReadHistory {
  private readonly invocations = new Map<string, string>()

  take(input: SessionStateWatcherStartInput): 'baseline' | 'live' {
    const key = JSON.stringify([input.provider, input.cwd, input.startedAtMs])
    const first = this.invocations.get(input.sessionId) !== key
    this.invocations.set(input.sessionId, key)
    return first && input.launchMode === 'new' ? 'live' : 'baseline'
  }

  release(sessionId: string, ended: boolean): void {
    if (ended) {
      this.invocations.delete(sessionId)
    }
  }

  clear(): void {
    this.invocations.clear()
  }
}
