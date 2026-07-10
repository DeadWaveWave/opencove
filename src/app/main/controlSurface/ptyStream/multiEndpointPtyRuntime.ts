import { randomUUID } from 'node:crypto'
import type {
  ListSessionsResult,
  PresentationSnapshotTerminalResult,
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import { RemotePtyEndpointProxy } from './remotePtyEndpointProxy'
import type { TerminalRuntimeRoute } from '../../../../contexts/terminal/domain/recovery/terminalRecovery'
import { createRemoteRecoveryCheckpointFence } from './remoteRecoveryCheckpointFence'

type RemoteSessionRoute = {
  kind: 'remote'
  endpointId: string
  remoteSessionId: string
}

type LocalSessionRoute = {
  kind: 'local'
}

type SessionRoute = LocalSessionRoute | RemoteSessionRoute

export class RemotePtyRecoveryBlockedError extends Error {
  public constructor(message = 'Authoritative remote PTY presentation snapshot unavailable') {
    super(message)
    this.name = 'RemotePtyRecoveryBlockedError'
  }
}

export type MultiEndpointPtyRuntime = ControlSurfacePtyRuntime & {
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
  dispose: () => void
}

export function createMultiEndpointPtyRuntime(options: {
  localRuntime: ControlSurfacePtyRuntime & { dispose?: () => void }
  topology: WorkerTopologyStore
  disposeLocalRuntime: boolean
}): MultiEndpointPtyRuntime {
  const normalizeResizeResult = (
    input: ResizeTerminalInput,
    result: TerminalGeometryCommitResult | void,
  ): TerminalGeometryCommitResult =>
    result ?? {
      sessionId: input.sessionId,
      operationId: input.operationId ?? `legacy-${input.sessionId}`,
      status: 'accepted',
      changed: true,
      geometry: { cols: input.cols, rows: input.rows, revision: null },
      authority: null,
    }
  const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const stateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  const presentationResetListeners = new Set<
    (event: {
      sessionId: string
      snapshot: PresentationSnapshotTerminalResult
    }) => void | Promise<void>
  >()
  const presentationResetCommittedListeners = new Set<
    (event: { sessionId: string; committed: boolean }) => void
  >()

  const routes = new Map<string, SessionRoute>()
  const homeSessionIdByRemote = new Map<string, string>()
  const remoteByHomeSessionId = new Map<string, { endpointId: string; remoteSessionId: string }>()
  const retiredRemoteCursorByHomeSessionId = new Map<
    string,
    { endpointId: string; remoteSessionId: string; cursor: number | null }
  >()
  const recoveryCheckpointFence = createRemoteRecoveryCheckpointFence()
  const pendingPresentationTransitionByRemote = new Map<
    string,
    { homeSessionId: string; settle: (committed?: boolean) => void }
  >()

  const proxiesByEndpointId = new Map<string, RemotePtyEndpointProxy>()

  const getProxy = (endpointId: string): RemotePtyEndpointProxy => {
    const existing = proxiesByEndpointId.get(endpointId)
    if (existing) {
      return existing
    }

    const created = new RemotePtyEndpointProxy({
      endpointId,
      topology: options.topology,
      emitData: (remoteSessionId, data) => {
        const homeSessionId = homeSessionIdByRemote.get(`${endpointId}:${remoteSessionId}`)
        if (!homeSessionId) {
          return
        }
        dataListeners.forEach(listener => listener({ sessionId: homeSessionId, data }))
      },
      emitExit: (remoteSessionId, exitCode) => {
        const remoteKey = `${endpointId}:${remoteSessionId}`
        const homeSessionId = homeSessionIdByRemote.get(remoteKey)
        if (!homeSessionId) {
          return
        }

        retiredRemoteCursorByHomeSessionId.set(homeSessionId, {
          endpointId,
          remoteSessionId,
          cursor: created.getReplayCursor(remoteSessionId),
        })
        homeSessionIdByRemote.delete(remoteKey)
        remoteByHomeSessionId.delete(homeSessionId)
        routes.delete(homeSessionId)
        created.forget(remoteSessionId)

        exitListeners.forEach(listener => listener({ sessionId: homeSessionId, exitCode }))
      },
      emitState: (remoteSessionId, state) => {
        const homeSessionId = homeSessionIdByRemote.get(`${endpointId}:${remoteSessionId}`)
        if (!homeSessionId) {
          return
        }

        stateListeners.forEach(listener => listener({ sessionId: homeSessionId, state }))
      },
      emitMetadata: (remoteSessionId, metadata) => {
        const homeSessionId = homeSessionIdByRemote.get(`${endpointId}:${remoteSessionId}`)
        if (!homeSessionId) {
          return
        }

        metadataListeners.forEach(listener =>
          listener({
            ...metadata,
            sessionId: homeSessionId,
          }),
        )
      },
      emitPresentationReset: async (remoteSessionId, snapshot) => {
        const remoteKey = `${endpointId}:${remoteSessionId}`
        const homeSessionId = homeSessionIdByRemote.get(remoteKey)
        if (!homeSessionId) {
          return
        }
        const settle = recoveryCheckpointFence.beginPresentationTransition(homeSessionId)
        pendingPresentationTransitionByRemote.set(remoteKey, { homeSessionId, settle })
        try {
          await Promise.all(
            [...presentationResetListeners].map(
              async listener =>
                await listener({
                  sessionId: homeSessionId,
                  snapshot: { ...snapshot, sessionId: homeSessionId },
                }),
            ),
          )
        } catch (error) {
          if (pendingPresentationTransitionByRemote.get(remoteKey)?.settle === settle) {
            pendingPresentationTransitionByRemote.delete(remoteKey)
          }
          settle(false)
          throw error
        }
      },
      emitPresentationResetCommitted: (remoteSessionId, committed) => {
        const remoteKey = `${endpointId}:${remoteSessionId}`
        const transition = pendingPresentationTransitionByRemote.get(remoteKey)
        if (transition) {
          pendingPresentationTransitionByRemote.delete(remoteKey)
          transition.settle(committed)
        }
        const homeSessionId = homeSessionIdByRemote.get(remoteKey) ?? transition?.homeSessionId
        if (!homeSessionId) {
          return
        }
        presentationResetCommittedListeners.forEach(listener =>
          listener({ sessionId: homeSessionId, committed }),
        )
      },
    })

    proxiesByEndpointId.set(endpointId, created)
    return created
  }

  const disposeLocalDataListener = options.localRuntime.onData(event => {
    dataListeners.forEach(listener => listener(event))
  })

  const disposeLocalExitListener = options.localRuntime.onExit(event => {
    exitListeners.forEach(listener => listener(event))
  })

  const disposeLocalStateListener = options.localRuntime.onState?.(event => {
    stateListeners.forEach(listener => listener(event))
  })

  const disposeLocalMetadataListener = options.localRuntime.onMetadata?.(event => {
    metadataListeners.forEach(listener => listener(event))
  })

  return {
    listProfiles: async () =>
      options.localRuntime.listProfiles
        ? await options.localRuntime.listProfiles()
        : { profiles: [], defaultProfileId: null },
    spawnSession: async spawnOptions => {
      const { sessionId } = await options.localRuntime.spawnSession(spawnOptions)
      routes.set(sessionId, { kind: 'local' })
      return { sessionId }
    },
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
    restoreRemoteSession: async ({
      homeSessionId,
      endpointId,
      remoteSessionId,
      targetWorkerInstanceId,
      afterSeq,
      beforeAttach,
    }) => {
      if (routes.has(homeSessionId) || remoteByHomeSessionId.has(homeSessionId)) {
        return null
      }
      const remoteKey = `${endpointId}:${remoteSessionId}`
      if (homeSessionIdByRemote.has(remoteKey)) {
        return null
      }

      const proxy = getProxy(endpointId)
      const restoredSession = await proxy.findSession(remoteSessionId, targetWorkerInstanceId)
      if (!restoredSession || restoredSession.kind !== 'terminal') {
        return null
      }

      const presentationSnapshot = await proxy
        .presentationSnapshot(remoteSessionId)
        .catch(() => null)
      if (
        !presentationSnapshot &&
        (restoredSession.status !== 'running' || typeof afterSeq !== 'number')
      ) {
        throw new RemotePtyRecoveryBlockedError()
      }
      const resumeAfterSeq = presentationSnapshot?.appliedSeq ?? afterSeq

      const settleRecoveryBaseline =
        recoveryCheckpointFence.beginPresentationTransition(homeSessionId)
      let recoveryBaselinePublished = false
      const publishRecoveryBaseline = (): void => {
        if (recoveryBaselinePublished) {
          return
        }
        recoveryBaselinePublished = true
        settleRecoveryBaseline(true)
      }
      routes.set(homeSessionId, { kind: 'remote', endpointId, remoteSessionId })
      retiredRemoteCursorByHomeSessionId.delete(homeSessionId)
      homeSessionIdByRemote.set(remoteKey, homeSessionId)
      remoteByHomeSessionId.set(homeSessionId, { endpointId, remoteSessionId })
      proxy.prepareAttach(remoteSessionId, resumeAfterSeq)
      try {
        await beforeAttach(restoredSession, presentationSnapshot, publishRecoveryBaseline)
        if (!recoveryBaselinePublished) {
          throw new Error(`Remote recovery baseline was not published: ${homeSessionId}`)
        }
      } catch (error) {
        settleRecoveryBaseline(false)
        routes.delete(homeSessionId)
        homeSessionIdByRemote.delete(remoteKey)
        remoteByHomeSessionId.delete(homeSessionId)
        proxy.forget(remoteSessionId)
        throw error
      }
      if (restoredSession.status !== 'running') {
        routes.delete(homeSessionId)
        homeSessionIdByRemote.delete(remoteKey)
        remoteByHomeSessionId.delete(homeSessionId)
        proxy.forget(remoteSessionId)
        return restoredSession
      }
      proxy.attach(remoteSessionId, resumeAfterSeq)
      return restoredSession
    },
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
    write: (sessionId, data) => {
      const route = routes.get(sessionId)
      if (!route || route.kind === 'local') {
        options.localRuntime.write(sessionId, data)
        return
      }

      getProxy(route.endpointId).write(route.remoteSessionId, data)
    },
    resize: async input => {
      const route = routes.get(input.sessionId)
      if (!route || route.kind === 'local') {
        return normalizeResizeResult(input, await options.localRuntime.resize(input))
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
    onData: listener => {
      dataListeners.add(listener)
      return () => {
        dataListeners.delete(listener)
      }
    },
    onExit: listener => {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    onState: listener => {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    onMetadata: listener => {
      metadataListeners.add(listener)
      return () => {
        metadataListeners.delete(listener)
      }
    },
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
      options.localRuntime.startSessionStateWatcher?.(input)
    },
    ...(options.localRuntime.debugCrashHost
      ? {
          debugCrashHost: () => options.localRuntime.debugCrashHost?.(),
        }
      : {}),
    dispose: () => {
      disposeLocalDataListener()
      disposeLocalExitListener()
      disposeLocalStateListener?.()
      disposeLocalMetadataListener?.()

      for (const proxy of proxiesByEndpointId.values()) {
        proxy.dispose()
      }
      proxiesByEndpointId.clear()

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
