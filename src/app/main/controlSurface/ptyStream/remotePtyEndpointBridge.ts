import type {
  PresentationSnapshotTerminalResult,
  TerminalForegroundEvent,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { createRemoteRecoveryCheckpointFence } from './remoteRecoveryCheckpointFence'
import { RemotePtyEndpointProxy } from './remotePtyEndpointProxy'
import type { ShellInputReadiness } from './shellInputReadiness'

export type SessionRoute =
  | { kind: 'local' }
  | { kind: 'remote'; endpointId: string; remoteSessionId: string }

export type RetiredRemoteSession = {
  endpointId: string
  remoteSessionId: string
  cursor: number | null
}

export type PtyRuntimeListenerSets = {
  data: Set<(event: { sessionId: string; data: string }) => void>
  exit: Set<(event: { sessionId: string; exitCode: number }) => void>
  foreground: Set<(event: TerminalForegroundEvent) => void>
  state: Set<(event: TerminalSessionStateEvent) => void>
  metadata: Set<(event: TerminalSessionMetadataEvent) => void>
  presentationReset: Set<
    (event: {
      sessionId: string
      snapshot: PresentationSnapshotTerminalResult
    }) => void | Promise<void>
  >
  presentationResetCommitted: Set<(event: { sessionId: string; committed: boolean }) => void>
}

/** Routing state owned by the multi-endpoint runtime and shared with its remote helpers. */
export type RemoteSessionRoutingState = {
  routes: Map<string, SessionRoute>
  homeSessionIdByRemote: Map<string, string>
  remoteByHomeSessionId: Map<string, { endpointId: string; remoteSessionId: string }>
  retiredRemoteCursorByHomeSessionId: Map<string, RetiredRemoteSession>
  pendingPresentationTransitionByRemote: Map<
    string,
    { homeSessionId: string; settle: (committed?: boolean) => void }
  >
  recoveryCheckpointFence: ReturnType<typeof createRemoteRecoveryCheckpointFence>
  shellInputReadiness: ShellInputReadiness
}

/**
 * Query-only route lookup. An exited remote session keeps its identity for recovery
 * snapshots; transcript queries share that lifetime without restoring a live route.
 */
export function readSessionRoute(
  state: Pick<RemoteSessionRoutingState, 'routes' | 'retiredRemoteCursorByHomeSessionId'>,
  sessionId: string,
): SessionRoute | null {
  const live = state.routes.get(sessionId)
  if (live) {
    return { ...live }
  }
  const retired = state.retiredRemoteCursorByHomeSessionId.get(sessionId)
  return retired
    ? { kind: 'remote', endpointId: retired.endpointId, remoteSessionId: retired.remoteSessionId }
    : null
}

/**
 * Connects to one remote endpoint and re-emits its PTY events under the home session ids
 * this runtime issued. Events for sessions this runtime does not route are dropped.
 */
export function createRemotePtyEndpointBridge(input: {
  endpointId: string
  topology: WorkerTopologyStore
  state: RemoteSessionRoutingState
  listeners: PtyRuntimeListenerSets
}): RemotePtyEndpointProxy {
  const { endpointId, state, listeners } = input
  const homeSessionIdFor = (remoteSessionId: string): string | undefined =>
    state.homeSessionIdByRemote.get(`${endpointId}:${remoteSessionId}`)

  const proxy: RemotePtyEndpointProxy = new RemotePtyEndpointProxy({
    endpointId,
    topology: input.topology,
    emitData: (remoteSessionId, data) => {
      const homeSessionId = homeSessionIdFor(remoteSessionId)
      if (!homeSessionId) {
        return
      }
      state.shellInputReadiness.markReady(homeSessionId)
      listeners.data.forEach(listener => listener({ sessionId: homeSessionId, data }))
    },
    emitExit: (remoteSessionId, exitCode) => {
      const remoteKey = `${endpointId}:${remoteSessionId}`
      const homeSessionId = state.homeSessionIdByRemote.get(remoteKey)
      if (!homeSessionId) {
        return
      }

      state.retiredRemoteCursorByHomeSessionId.set(homeSessionId, {
        endpointId,
        remoteSessionId,
        cursor: proxy.getReplayCursor(remoteSessionId),
      })
      state.homeSessionIdByRemote.delete(remoteKey)
      state.remoteByHomeSessionId.delete(homeSessionId)
      state.routes.delete(homeSessionId)
      state.shellInputReadiness.forget(homeSessionId)
      proxy.forget(remoteSessionId)

      listeners.exit.forEach(listener => listener({ sessionId: homeSessionId, exitCode }))
    },
    emitForeground: (remoteSessionId, event) => {
      const homeSessionId = homeSessionIdFor(remoteSessionId)
      if (!homeSessionId) {
        return
      }
      listeners.foreground.forEach(listener => listener({ ...event, sessionId: homeSessionId }))
    },
    emitState: (remoteSessionId, event) => {
      const homeSessionId = homeSessionIdFor(remoteSessionId)
      if (!homeSessionId) {
        return
      }
      listeners.state.forEach(listener =>
        listener({ ...event, sessionId: homeSessionId, remote: true }),
      )
    },
    emitMetadata: (remoteSessionId, metadata) => {
      const homeSessionId = homeSessionIdFor(remoteSessionId)
      if (!homeSessionId) {
        return
      }
      listeners.metadata.forEach(listener =>
        listener({ ...metadata, remote: true, sessionId: homeSessionId }),
      )
    },
    emitPresentationReset: async (remoteSessionId, snapshot) => {
      const remoteKey = `${endpointId}:${remoteSessionId}`
      const homeSessionId = state.homeSessionIdByRemote.get(remoteKey)
      if (!homeSessionId) {
        return
      }
      const settle = state.recoveryCheckpointFence.beginPresentationTransition(homeSessionId)
      state.pendingPresentationTransitionByRemote.set(remoteKey, { homeSessionId, settle })
      try {
        await Promise.all(
          [...listeners.presentationReset].map(
            async listener =>
              await listener({
                sessionId: homeSessionId,
                snapshot: { ...snapshot, sessionId: homeSessionId },
              }),
          ),
        )
      } catch (error) {
        if (state.pendingPresentationTransitionByRemote.get(remoteKey)?.settle === settle) {
          state.pendingPresentationTransitionByRemote.delete(remoteKey)
        }
        settle(false)
        throw error
      }
    },
    emitPresentationResetCommitted: (remoteSessionId, committed) => {
      const remoteKey = `${endpointId}:${remoteSessionId}`
      const transition = state.pendingPresentationTransitionByRemote.get(remoteKey)
      if (transition) {
        state.pendingPresentationTransitionByRemote.delete(remoteKey)
        transition.settle(committed)
      }
      const homeSessionId = state.homeSessionIdByRemote.get(remoteKey) ?? transition?.homeSessionId
      if (!homeSessionId) {
        return
      }
      listeners.presentationResetCommitted.forEach(listener =>
        listener({ sessionId: homeSessionId, committed }),
      )
    },
  })
  return proxy
}
