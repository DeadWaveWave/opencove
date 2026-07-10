import type { PresentationSnapshotTerminalResult } from '../../../../shared/contracts/dto'

export interface PtyStreamPresentationResetBarrier {
  apply: (event: {
    sessionId: string
    snapshot: PresentationSnapshotTerminalResult
  }) => Promise<void>
  settle: (event: { sessionId: string; committed: boolean }) => void
  drainAndStopAccepting: () => Promise<void>
  dispose: () => void
}

export function createPtyStreamPresentationResetBarrier(options: {
  expectsCommit: boolean
  applyReset: (event: {
    sessionId: string
    snapshot: PresentationSnapshotTerminalResult
  }) => Promise<void>
  onCommitted: (sessionId: string) => void
}): PtyStreamPresentationResetBarrier {
  const lifecycles = new Set<Promise<void>>()
  const pendingCommitResolvers = new Map<string, Array<() => void>>()
  let stopping = false

  const removeCommitResolver = (sessionId: string, resolver: () => void): void => {
    const pending = pendingCommitResolvers.get(sessionId)
    const index = pending?.indexOf(resolver) ?? -1
    if (!pending || index < 0) {
      return
    }
    pending.splice(index, 1)
    if (pending.length === 0) {
      pendingCommitResolvers.delete(sessionId)
    }
  }

  const track = (lifecycle: Promise<void>): void => {
    lifecycles.add(lifecycle)
    void lifecycle.catch(() => undefined).finally(() => lifecycles.delete(lifecycle))
  }

  const apply = async (event: {
    sessionId: string
    snapshot: PresentationSnapshotTerminalResult
  }): Promise<void> => {
    if (stopping) {
      throw new Error('PTY stream presentation reset barrier is stopping')
    }
    const operation = options.applyReset(event)
    if (!options.expectsCommit) {
      const lifecycle = operation.then(() => options.onCommitted(event.sessionId))
      track(lifecycle)
      return await lifecycle
    }

    let resolveCommitted: () => void = () => undefined
    const committed = new Promise<void>(resolvePromise => {
      resolveCommitted = resolvePromise
    })
    const pending = pendingCommitResolvers.get(event.sessionId) ?? []
    pending.push(resolveCommitted)
    pendingCommitResolvers.set(event.sessionId, pending)
    const lifecycle = operation.then(
      async () => await committed,
      error => {
        removeCommitResolver(event.sessionId, resolveCommitted)
        resolveCommitted()
        throw error
      },
    )
    track(lifecycle)
    await operation
  }

  return {
    apply,
    settle: ({ sessionId, committed }) => {
      if (committed) {
        options.onCommitted(sessionId)
      }
      const pending = pendingCommitResolvers.get(sessionId)
      const resolveCommitted = pending?.shift()
      if (pending?.length === 0) {
        pendingCommitResolvers.delete(sessionId)
      }
      resolveCommitted?.()
    },
    drainAndStopAccepting: async () => {
      stopping = true
      await Promise.all([...lifecycles])
    },
    dispose: () => {
      stopping = true
      for (const resolvers of pendingCommitResolvers.values()) {
        resolvers.forEach(resolve => resolve())
      }
      pendingCommitResolvers.clear()
    },
  }
}
