import type { SessionState } from './ptyStreamState'

export class PtyStreamRecoveryOperationTracker {
  private readonly inFlight = new Set<Promise<unknown>>()

  public async track<TResult>(operation: Promise<TResult>): Promise<TResult> {
    this.inFlight.add(operation)
    try {
      return await operation
    } finally {
      this.inFlight.delete(operation)
    }
  }

  public async drain(sessions: Map<string, SessionState>): Promise<void> {
    for (;;) {
      const observedSessions = [...sessions.values()]
      const observedChains = observedSessions.map(session => session.operationChain)
      const observedOperations = [...this.inFlight]
      // eslint-disable-next-line no-await-in-loop
      await Promise.allSettled([...observedChains, ...observedOperations])
      const stable =
        this.inFlight.size === 0 &&
        observedSessions.length === sessions.size &&
        observedSessions.every(
          (session, index) =>
            sessions.get(session.sessionId) === session &&
            session.operationQueueDepth === 0 &&
            session.operationChain === observedChains[index],
        )
      if (stable) {
        return
      }
    }
  }
}
