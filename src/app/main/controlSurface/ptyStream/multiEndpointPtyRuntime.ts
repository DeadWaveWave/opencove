import { randomUUID } from 'node:crypto'
import type {
  ListSessionsResult,
  PresentationSnapshotTerminalResult,
} from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { RemotePtyEndpointProxy } from './remotePtyEndpointProxy'
import type { TerminalRuntimeRoute } from '../../../../contexts/terminal/domain/recovery/terminalRecovery'
import { createRemoteRecoveryCheckpointFence } from './remoteRecoveryCheckpointFence'
import { ShellInputReadiness } from './shellInputReadiness'
import { subscribeAgentSources, subscribePtyRuntimeListener } from './ptyRuntimeListeners'
import { AgentLaunchArtifactOwner } from '../../../../contexts/agent/application/services/AgentLaunchArtifactOwner'
import { spawnLocalSessionWithArtifacts } from './localAgentLaunchArtifactLifecycle'
import { reexecTerminalAgentInPty } from '../../../../contexts/agent/application/terminalAgentPtyReexec'
import { restoreRemotePtySession } from './restoreRemotePtySession'
import { SessionRegistrationOwner } from '../../../../shared/runtime/sessionRegistrationOwner'
import {
  createRemotePtyEndpointBridge,
  readSessionRoute,
  type PtyRuntimeListenerSets,
  type RemoteSessionRoutingState,
  type SessionRoute,
} from './remotePtyEndpointBridge'
export { RemotePtyRecoveryBlockedError } from './RemotePtyRecoveryBlockedError'

export type MultiEndpointPtyRuntime = ControlSurfacePtyRuntime & {
  /** Query identity only; retained remote identity does not imply a live PTY. */
  getSessionRoute?: (sessionId: string) => SessionRoute | null
  registerRemoteSession: (options: { endpointId: string; remoteSessionId: string }) => string
  restoreRemoteSession: (options: {
    homeSessionId: string
    endpointId: string
    remoteSessionId: string
    targetWorkerInstanceId?: string | null
    afterSeq?: number | null
    beforeAttach: (
      session: ListSessionsResult['sessions'][number],
      presentationSnapshot: PresentationSnapshotTerminalResult | null,
      publishRecoveryBaseline: () => void,
    ) => void | Promise<void>
  }) => Promise<ListSessionsResult['sessions'][number] | null>
  resolveRecoveryRoute: (
    sessionId: string,
    homeWorkerInstanceId: string,
  ) => Promise<TerminalRuntimeRoute | null>
  captureRecoveryPresentationSnapshot: <TSnapshot>(
    sessionId: string,
    captureSnapshot: () => Promise<TSnapshot>,
  ) => Promise<{
    snapshot: TSnapshot
    downstreamReplayCursor: number | null
  }>
  drainPresentationRecovery: () => Promise<void>
  drainLaunchArtifacts: () => Promise<void>
  dispose: () => void
}

export function createMultiEndpointPtyRuntime(options: {
  localRuntime: ControlSurfacePtyRuntime & { dispose?: () => void }
  topology: WorkerTopologyStore
  disposeLocalRuntime: boolean
  agentStateSources?: readonly Pick<ControlSurfacePtyRuntime, 'onState'>[]
  agentMetadataSources?: readonly Pick<ControlSurfacePtyRuntime, 'onMetadata'>[]
}): MultiEndpointPtyRuntime {
  const listeners: PtyRuntimeListenerSets = {
    data: new Set(),
    exit: new Set(),
    foreground: new Set(),
    state: new Set(),
    metadata: new Set(),
    presentationReset: new Set(),
    presentationResetCommitted: new Set(),
  }
  const {
    data: dataListeners,
    exit: exitListeners,
    foreground: foregroundListeners,
    state: stateListeners,
    metadata: metadataListeners,
    presentationReset: presentationResetListeners,
    presentationResetCommitted: presentationResetCommittedListeners,
  } = listeners

  const state: RemoteSessionRoutingState = {
    routes: new Map(),
    homeSessionIdByRemote: new Map(),
    remoteByHomeSessionId: new Map(),
    retiredRemoteCursorByHomeSessionId: new Map(),
    pendingPresentationTransitionByRemote: new Map(),
    recoveryCheckpointFence: createRemoteRecoveryCheckpointFence(),
    shellInputReadiness: new ShellInputReadiness(),
  }
  const {
    routes,
    homeSessionIdByRemote,
    remoteByHomeSessionId,
    retiredRemoteCursorByHomeSessionId,
    pendingPresentationTransitionByRemote,
    recoveryCheckpointFence,
    shellInputReadiness,
  } = state
  const launchArtifactOwner = new AgentLaunchArtifactOwner(error => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`[opencove] failed to dispose Agent launch artifacts: ${detail}\n`)
  })
  const localSessionRegistrations = new SessionRegistrationOwner()

  const proxiesByEndpointId = new Map<string, RemotePtyEndpointProxy>()

  const getProxy = (endpointId: string): RemotePtyEndpointProxy => {
    const existing = proxiesByEndpointId.get(endpointId)
    if (existing) {
      return existing
    }
    const created = createRemotePtyEndpointBridge({
      endpointId,
      topology: options.topology,
      state,
      listeners,
    })
    proxiesByEndpointId.set(endpointId, created)
    return created
  }

  const disposeLocalDataListener = options.localRuntime.onData(event => {
    shellInputReadiness.markReady(event.sessionId)
    dataListeners.forEach(listener => listener(event))
  })

  const disposeLocalExitListener = options.localRuntime.onExit(event => {
    localSessionRegistrations.noteCompletion(event.sessionId)
    routes.delete(event.sessionId)
    shellInputReadiness.forget(event.sessionId)
    launchArtifactOwner.release(event.sessionId)
    exitListeners.forEach(listener => listener(event))
  })

  const disposeLocalForegroundListener = options.localRuntime.onForeground?.(event => {
    foregroundListeners.forEach(listener => listener(event))
  })

  const disposeLocalStateListener = options.localRuntime.onState?.(event => {
    stateListeners.forEach(listener => listener(event))
  })

  const disposeLocalMetadataListener = options.localRuntime.onMetadata?.(event => {
    metadataListeners.forEach(listener => listener(event))
  })

  const agentSourceDisposers = subscribeAgentSources(options, stateListeners, metadataListeners)

  return {
    listProfiles: async () =>
      options.localRuntime.listProfiles
        ? await options.localRuntime.listProfiles()
        : { profiles: [], defaultProfileId: null },
    spawnSession: async spawnOptions => {
      const { sessionId } = await spawnLocalSessionWithArtifacts(
        options.localRuntime,
        spawnOptions,
        launchArtifactOwner,
        localSessionRegistrations.begin(),
        registeredSessionId => routes.set(registeredSessionId, { kind: 'local' }),
      )
      if (spawnOptions.agentProvider) {
        metadataListeners.forEach(listener =>
          listener({ sessionId, resumeSessionId: null, agentProvider: spawnOptions.agentProvider }),
        )
        stateListeners.forEach(listener =>
          listener({
            sessionId,
            agentProvider: spawnOptions.agentProvider,
            source: 'launch',
            state: spawnOptions.initialAgentState ?? 'standby',
          }),
        )
      }
      return { sessionId }
    },
    waitForShellReady: async sessionId => {
      await shellInputReadiness.wait(sessionId)
    },
    getSessionRoute: sessionId => readSessionRoute(state, sessionId),
    registerRemoteSession: ({ endpointId, remoteSessionId }) => {
      const homeSessionId = randomUUID()
      recoveryCheckpointFence.reset(homeSessionId)
      routes.set(homeSessionId, { kind: 'remote', endpointId, remoteSessionId })
      retiredRemoteCursorByHomeSessionId.delete(homeSessionId)
      homeSessionIdByRemote.set(`${endpointId}:${remoteSessionId}`, homeSessionId)
      remoteByHomeSessionId.set(homeSessionId, { endpointId, remoteSessionId })

      const proxy = getProxy(endpointId)
      proxy.attach(remoteSessionId)

      return homeSessionId
    },
    restoreRemoteSession: async input =>
      await restoreRemotePtySession({
        ...input,
        routes,
        homeSessionIdByRemote,
        remoteByHomeSessionId,
        retiredRemoteCursorByHomeSessionId,
        recoveryCheckpointFence,
        getProxy,
      }),
    resolveRecoveryRoute: async (sessionId, homeWorkerInstanceId) => {
      const route = routes.get(sessionId)
      if (!route) {
        return null
      }
      if (route.kind === 'local') {
        return { kind: 'local', workerInstanceId: homeWorkerInstanceId }
      }
      return {
        kind: 'remote',
        homeWorkerInstanceId,
        endpointId: route.endpointId,
        remoteSessionId: route.remoteSessionId,
        targetWorkerInstanceId: await getProxy(route.endpointId).resolveServerInstanceId(),
      }
    },
    captureRecoveryPresentationSnapshot: async (sessionId, captureSnapshot) => {
      const readCursor = () => {
        const route = remoteByHomeSessionId.get(sessionId)
        if (route) {
          return getProxy(route.endpointId).getReplayCursor(route.remoteSessionId)
        }
        return retiredRemoteCursorByHomeSessionId.get(sessionId)?.cursor ?? null
      }
      return await recoveryCheckpointFence.capture({ sessionId, readCursor, captureSnapshot })
    },
    drainPresentationRecovery: async () => {
      for (;;) {
        const observed = [...proxiesByEndpointId.values()]
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(observed.map(async proxy => await proxy.drainPresentationRecovery()))
        if (
          observed.length === proxiesByEndpointId.size &&
          observed.every(proxy => [...proxiesByEndpointId.values()].includes(proxy))
        ) {
          return
        }
      }
    },
    drainLaunchArtifacts: async () => await launchArtifactOwner.drain(),
    write: (sessionId, data) => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.write(sessionId, data)
        return
      }

      getProxy(route.endpointId).write(route.remoteSessionId, data)
    },
    probeForeground: sessionId => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.probeForeground?.(sessionId)
      }
    },
    reexecAgent: async input => {
      const route = routes.get(input.sessionId)
      if (!route || route.kind === 'local') {
        const status = await reexecTerminalAgentInPty({
          ...input,
          runtime: {
            write: options.localRuntime.write,
            probeForeground: options.localRuntime.probeForeground,
            onExit: listener => subscribePtyRuntimeListener(exitListeners, listener),
            onForeground: listener => subscribePtyRuntimeListener(foregroundListeners, listener),
            onMetadata: listener => subscribePtyRuntimeListener(metadataListeners, listener),
          },
        })
        return { sessionId: input.sessionId, operationId: input.operationId, status }
      }
      const result = await getProxy(route.endpointId).reexecAgent({
        ...input,
        sessionId: route.remoteSessionId,
      })
      return { ...result, sessionId: input.sessionId }
    },
    resize: async input => {
      const route = routes.get(input.sessionId)
      if (!route || route.kind === 'local') {
        return await options.localRuntime.resize(input)
      }

      // Geometry revisions and authority epochs are scoped to one Hub. The Home Hub has already
      // validated its own CAS/lease; forwarding those counters to the Remote Hub would compare
      // unrelated revision domains and can permanently supersede otherwise valid resizes.
      const {
        authorityEpoch: _upstreamAuthorityEpoch,
        baseGeometryRevision: _upstreamBaseGeometryRevision,
        revision: _upstreamLegacyRevision,
        ...downstreamInput
      } = input
      void _upstreamAuthorityEpoch
      void _upstreamBaseGeometryRevision
      void _upstreamLegacyRevision
      const remoteResult = await getProxy(route.endpointId).resize({
        ...downstreamInput,
        sessionId: route.remoteSessionId,
      })
      return {
        ...remoteResult,
        sessionId: input.sessionId,
      }
    },
    kill: sessionId => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.kill(sessionId)
        return
      }

      getProxy(route.endpointId).kill(route.remoteSessionId)
    },
    onData: listener => subscribePtyRuntimeListener(dataListeners, listener),
    onExit: listener => subscribePtyRuntimeListener(exitListeners, listener),
    onForeground: listener => subscribePtyRuntimeListener(foregroundListeners, listener),
    onState: listener => subscribePtyRuntimeListener(stateListeners, listener),
    onMetadata: listener => subscribePtyRuntimeListener(metadataListeners, listener),
    onPresentationReset: listener => {
      presentationResetListeners.add(listener)
      return () => {
        presentationResetListeners.delete(listener)
      }
    },
    onPresentationResetCommitted: listener => {
      presentationResetCommittedListeners.add(listener)
      return () => {
        presentationResetCommittedListeners.delete(listener)
      }
    },
    startSessionStateWatcher: input => {
      const route = routes.get(input.sessionId)
      if (!route || route.kind === 'local') {
        metadataListeners.forEach(listener =>
          listener({
            sessionId: input.sessionId,
            resumeSessionId: input.resumeSessionId,
            agentProvider: input.provider,
          }),
        )
        options.localRuntime.startSessionStateWatcher?.(input)
      }
    },
    disposeSessionStateWatcher: sessionId => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.disposeSessionStateWatcher?.(sessionId)
      }
    },
    ...(options.localRuntime.debugCrashHost
      ? {
          debugCrashHost: () => options.localRuntime.debugCrashHost?.(),
        }
      : {}),
    dispose: () => {
      shellInputReadiness.dispose()
      disposeLocalDataListener()
      disposeLocalExitListener()
      disposeLocalForegroundListener?.()
      disposeLocalStateListener?.()
      disposeLocalMetadataListener?.()
      agentSourceDisposers.forEach(disposeListener => disposeListener())

      for (const proxy of proxiesByEndpointId.values()) {
        proxy.dispose()
      }
      proxiesByEndpointId.clear()

      localSessionRegistrations.dispose()
      routes.clear()
      homeSessionIdByRemote.clear()
      remoteByHomeSessionId.clear()
      retiredRemoteCursorByHomeSessionId.clear()
      for (const transition of pendingPresentationTransitionByRemote.values()) {
        transition.settle(false)
      }
      pendingPresentationTransitionByRemote.clear()
      presentationResetListeners.clear()
      presentationResetCommittedListeners.clear()
      foregroundListeners.clear()

      launchArtifactOwner.releaseAll()

      if (options.disposeLocalRuntime) {
        try {
          options.localRuntime.dispose?.()
        } catch {
          // ignore
        }
      }
    },
  }
}
