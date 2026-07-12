import type { PresentationSnapshotTerminalResult } from '../../../../shared/contracts/dto'
import type { RemotePtyEndpointAttachedSessionState } from './remotePtyEndpointProxy.messageHandler'

type BufferedRemotePtyEvent =
  | { kind: 'data'; seq: number; data: string }
  | { kind: 'exit'; seq: number; exitCode: number }

type RemoteOverflowRecovery = {
  buffered: BufferedRemotePtyEvent[]
}

export interface RemotePtyOverflowRecoveryCoordinator {
  handleData: (remoteSessionId: string, data: string, seq: number) => void
  handleExit: (remoteSessionId: string, exitCode: number, seq: number) => void
  begin: (remoteSessionId: string) => void
  drainAndStopAccepting: () => Promise<void>
  forget: (remoteSessionId: string) => void
  dispose: () => void
}

export function createRemotePtyOverflowRecoveryCoordinator(options: {
  attachedSessions: Map<string, RemotePtyEndpointAttachedSessionState>
  fetchPresentationSnapshot: (
    remoteSessionId: string,
  ) => Promise<PresentationSnapshotTerminalResult>
  applyPresentationReset: (
    remoteSessionId: string,
    snapshot: PresentationSnapshotTerminalResult,
  ) => Promise<void>
  onPresentationResetSettled: (remoteSessionId: string, committed: boolean) => void
  emitData: (remoteSessionId: string, data: string) => void
  emitExit: (remoteSessionId: string, exitCode: number) => void
  reconnectFromLastAppliedCursor: () => void
}): RemotePtyOverflowRecoveryCoordinator {
  const recoveryBySessionId = new Map<string, RemoteOverflowRecovery>()
  const inFlightRecoveries = new Set<Promise<void>>()
  let disposed = false
  let stopping = false

  const handleData = (remoteSessionId: string, data: string, seq: number): void => {
    const recovery = recoveryBySessionId.get(remoteSessionId)
    if (recovery) {
      recovery.buffered.push({ kind: 'data', seq, data })
      return
    }
    if (stopping) {
      return
    }
    const state = options.attachedSessions.get(remoteSessionId)
    if (!state || seq <= state.lastSeq) {
      return
    }
    state.lastSeq = seq
    options.emitData(remoteSessionId, data)
  }

  const handleExit = (remoteSessionId: string, exitCode: number, seq: number): void => {
    const recovery = recoveryBySessionId.get(remoteSessionId)
    if (recovery) {
      recovery.buffered.push({ kind: 'exit', seq, exitCode })
      return
    }
    if (stopping) {
      return
    }
    const state = options.attachedSessions.get(remoteSessionId)
    if (!state) {
      return
    }
    state.lastSeq = Math.max(state.lastSeq, seq)
    options.emitExit(remoteSessionId, exitCode)
  }

  const recover = async (
    remoteSessionId: string,
    recovery: RemoteOverflowRecovery,
  ): Promise<void> => {
    const snapshot = await options.fetchPresentationSnapshot(remoteSessionId)
    if (
      disposed ||
      recoveryBySessionId.get(remoteSessionId) !== recovery ||
      !options.attachedSessions.has(remoteSessionId)
    ) {
      return
    }
    await options.applyPresentationReset(remoteSessionId, snapshot)
    if (disposed || recoveryBySessionId.get(remoteSessionId) !== recovery) {
      options.onPresentationResetSettled(remoteSessionId, false)
      return
    }
    const state = options.attachedSessions.get(remoteSessionId)
    recoveryBySessionId.delete(remoteSessionId)
    if (!state) {
      return
    }

    // The cursor becomes public only after the replacement presentation has been applied.
    state.lastSeq = Math.max(state.lastSeq, snapshot.appliedSeq)
    options.onPresentationResetSettled(remoteSessionId, true)
    const buffered = [...recovery.buffered].sort((left, right) => left.seq - right.seq)
    for (const event of buffered) {
      if (event.kind === 'data') {
        if (event.seq <= state.lastSeq) {
          continue
        }
        state.lastSeq = event.seq
        options.emitData(remoteSessionId, event.data)
        continue
      }
      state.lastSeq = Math.max(state.lastSeq, event.seq)
      options.emitExit(remoteSessionId, event.exitCode)
      break
    }
  }

  const begin = (remoteSessionId: string): void => {
    if (
      disposed ||
      stopping ||
      recoveryBySessionId.has(remoteSessionId) ||
      !options.attachedSessions.has(remoteSessionId)
    ) {
      return
    }
    const recovery: RemoteOverflowRecovery = { buffered: [] }
    recoveryBySessionId.set(remoteSessionId, recovery)
    const lifecycle = recover(remoteSessionId, recovery)
      .catch(() => {
        if (recoveryBySessionId.get(remoteSessionId) === recovery) {
          recoveryBySessionId.delete(remoteSessionId)
        }
        // Buffered events are deliberately discarded. Reconnect from the unchanged public cursor,
        // then replay or re-enter this single-flight snapshot resync without committing a gap.
        if (!disposed && !stopping) {
          options.reconnectFromLastAppliedCursor()
        }
      })
      .finally(() => {
        inFlightRecoveries.delete(lifecycle)
      })
    inFlightRecoveries.add(lifecycle)
    void lifecycle
  }

  return {
    handleData,
    handleExit,
    begin,
    drainAndStopAccepting: async () => {
      stopping = true
      for (;;) {
        const observed = [...inFlightRecoveries]
        if (observed.length === 0) {
          return
        }
        // Recoveries may settle and remove themselves while this drain awaits the observed set.
        // eslint-disable-next-line no-await-in-loop
        await Promise.allSettled(observed)
      }
    },
    forget: remoteSessionId => {
      recoveryBySessionId.delete(remoteSessionId)
    },
    dispose: () => {
      disposed = true
      stopping = true
      recoveryBySessionId.clear()
    },
  }
}
