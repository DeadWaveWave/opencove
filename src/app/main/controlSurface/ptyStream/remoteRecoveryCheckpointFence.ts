type SessionFenceState = {
  activePresentationTransitions: number
  invalidated: boolean
  idleWaiters: Set<() => void>
}

export interface RemoteRecoveryCheckpointFence {
  beginPresentationTransition: (sessionId: string) => (committed?: boolean) => void
  reset: (sessionId: string) => void
  capture: <TSnapshot>(options: {
    sessionId: string
    readCursor: () => number | null
    /** Must synchronously establish the Home presentation operation boundary before yielding. */
    captureSnapshot: () => Promise<TSnapshot>
  }) => Promise<{ snapshot: TSnapshot; downstreamReplayCursor: number | null }>
}

export function createRemoteRecoveryCheckpointFence(): RemoteRecoveryCheckpointFence {
  const stateBySessionId = new Map<string, SessionFenceState>()

  const ensureState = (sessionId: string): SessionFenceState => {
    const existing = stateBySessionId.get(sessionId)
    if (existing) {
      return existing
    }
    const created: SessionFenceState = {
      activePresentationTransitions: 0,
      invalidated: false,
      idleWaiters: new Set(),
    }
    stateBySessionId.set(sessionId, created)
    return created
  }

  const waitUntilIdle = async (state: SessionFenceState): Promise<void> => {
    if (state.activePresentationTransitions === 0) {
      return
    }
    await new Promise<void>(resolve => {
      state.idleWaiters.add(resolve)
    })
  }

  return {
    beginPresentationTransition: sessionId => {
      const state = ensureState(sessionId)
      state.activePresentationTransitions += 1
      let settled = false
      return (committed = true) => {
        if (settled) {
          return
        }
        settled = true
        state.activePresentationTransitions = Math.max(0, state.activePresentationTransitions - 1)
        state.invalidated = !committed
        if (state.activePresentationTransitions === 0) {
          const waiters = [...state.idleWaiters]
          state.idleWaiters.clear()
          waiters.forEach(resolve => resolve())
        }
      }
    },
    reset: sessionId => {
      const state = ensureState(sessionId)
      if (state.activePresentationTransitions > 0) {
        throw new Error(`Remote recovery checkpoint reset raced an active transition: ${sessionId}`)
      }
      state.invalidated = false
    },
    capture: async options => {
      const state = ensureState(options.sessionId)
      while (state.activePresentationTransitions > 0) {
        // A reset already in progress must publish its Home presentation and cursor before capture.
        // eslint-disable-next-line no-await-in-loop
        await waitUntilIdle(state)
      }
      if (state.invalidated) {
        throw new Error(`Remote recovery checkpoint invalidated: ${options.sessionId}`)
      }
      // Remote data publishes its cursor and queues Home output synchronously. Reading the cursor
      // immediately before captureSnapshot therefore defines the same boundary that the Hub then
      // freezes by flushing pending data and capturing its xterm operation chain. Later output is
      // intentionally left for the next checkpoint/replay instead of forcing an unbounded retry.
      const downstreamReplayCursor = options.readCursor()
      const snapshot = await options.captureSnapshot()
      return { snapshot, downstreamReplayCursor }
    },
  }
}
