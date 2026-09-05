import { randomBytes, randomUUID } from 'node:crypto'
import { ManagedSshEndpointOperationOwner } from '../../../contexts/topology/application/ManagedSshEndpointOperationOwner'
import { createManagedSshOperationDiagnosticSink } from './topology/managedSshOperationDiagnostics'
import type { ServerResponse } from 'node:http'
import { createControlSurface } from './controlSurface'
import { WebSessionManager } from './http/webSessionManager'
import { createLazyPersistenceStore } from './http/lazyPersistenceStore'
import { publishLiveSyncEvent } from './http/publishSyncEvent'
import type { SyncEventPayload } from './http/syncSse'
import { createPtyStreamService, PTY_STREAM_PROTOCOL_VERSION } from './ptyStream/ptyStreamService'
import { createMultiEndpointPtyRuntime } from './ptyStream/multiEndpointPtyRuntime'
import type { RegisterControlSurfaceHttpServerOptions } from './controlSurfaceHttpServerOptions'
import { createWorkerTopologyStore } from './topology/topologyStore'
import { registerControlSurfaceHandlers } from './registerControlSurfaceHandlers'
import { createManagedSshEndpointRuntime } from './topology/managedSshEndpointRuntime'
import { createEndpointHealthService } from './topology/endpointHealthService'
import { createControlSurfaceTerminalRecoveryRuntime } from './terminalRecovery/controlSurfaceTerminalRecoveryRuntime'
import { TerminalRuntimeAvailability } from '../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { initializeTerminalRuntimeAvailability } from './terminalRecovery/terminalRuntimeStartup'
import { createControlSurfaceHttpServerContext } from './controlSurfaceHttpServerContext'
import { createTerminalAgentActivityRuntime } from './terminalAgentActivityRuntime'
import { normalizeControlSurfaceAppVersion } from './controlSurfaceHttpServer.contract'
import type {
  ControlSurfaceHttpListener,
  ControlSurfaceHttpRuntime,
  ControlSurfaceWebAccessPolicy,
} from './controlSurfaceHttpRuntime.contract'
import { createControlSurfaceHttpRequestHandler } from './controlSurfaceHttpRequestHandler'
import { createControlSurfaceHttpListener } from './controlSurfaceHttpListener'
import { ControlSurfaceAcceptedRequestOwner } from './controlSurfaceAcceptedRequestOwner'

const PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES = 400_000

export function createControlSurfaceHttpRuntime(
  options: RegisterControlSurfaceHttpServerOptions,
): ControlSurfaceHttpRuntime {
  const token = options.token ?? randomBytes(32).toString('base64url')
  const appVersion = normalizeControlSurfaceAppVersion(options.appVersion)
  const webSessions = new WebSessionManager()
  const ctx = createControlSurfaceHttpServerContext({
    enableWebShell: options.enableWebShell === true,
    ptyProtocolVersion: PTY_STREAM_PROTOCOL_VERSION,
    replayWindowMaxBytes: PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES,
  })
  let webAccessPolicy: ControlSurfaceWebAccessPolicy = {
    enabled: options.enableWebShell === true,
    passwordRequired: Boolean(options.webUiPasswordHash),
  }

  const managedSshRuntime = createManagedSshEndpointRuntime({ appVersion })
  const managedSshOperations = new ManagedSshEndpointOperationOwner({
    preparationPort: managedSshRuntime,
    createOperationId: randomUUID,
    now: Date.now,
    diagnosticSink: createManagedSshOperationDiagnosticSink(options.userDataPath),
  })
  const topologyStore = createWorkerTopologyStore({
    userDataPath: options.userDataPath,
    disposeManagedSshEndpointRuntime: async access => {
      const operationDrain = managedSshOperations.disposeEndpoint(access.endpointId)
      const resourceDrain = managedSshRuntime.disposeEndpoint(access)
      await Promise.all([operationDrain, resourceDrain])
    },
  })
  const topology: typeof topologyStore = {
    ...topologyStore,
    updateManagedSshEndpoint: input =>
      managedSshOperations.withEndpointMutation(
        input.endpointId,
        async () => await topologyStore.updateManagedSshEndpoint(input),
      ),
    removeEndpoint: input =>
      managedSshOperations.withEndpointMutation(
        input.endpointId,
        async () => await topologyStore.removeEndpoint(input),
      ),
    resolveRemoteEndpointConnection: async endpointId => {
      const assertAdmission = managedSshOperations.captureAdmission(endpointId)
      const access = await topologyStore.resolveEndpointRuntimeAccess(endpointId)
      assertAdmission()
      if (!access) {
        return null
      }
      if (access.kind === 'manual') {
        return access.connection
      }
      if (managedSshOperations.hasActiveOperation(endpointId)) {
        return null
      }
      return await managedSshRuntime.resolveConnection({
        endpointId,
        displayName: access.endpoint.displayName,
        token: access.token,
        ssh: access.managedSsh,
      })
    },
  }
  const endpointHealth = createEndpointHealthService({
    topology,
    managedRuntime: managedSshRuntime,
    operations: managedSshOperations,
  })
  const agentHookChannels =
    options.agentHookChannels ?? (options.claudeHookChannel ? [options.claudeHookChannel] : [])
  const terminalAgents = createTerminalAgentActivityRuntime({
    agentHookChannels,
    agentProviderRegistry: options.agentProviderRegistry,
    appVersion,
    desktopMetadataSink: options.desktopPtyMetadataSink,
    desktopStateSink: options.desktopPtyStateSink,
    disposeSessionStateWatcher: options.ptyRuntime.disposeSessionStateWatcher,
  })
  const agentProviderRegistry = terminalAgents.agentProviderRegistry
  const ptyRuntime = createMultiEndpointPtyRuntime({
    localRuntime: options.ptyRuntime,
    topology,
    disposeLocalRuntime: options.ownsPtyRuntime === true,
    agentStateSources: terminalAgents.stateSources,
    agentMetadataSources: terminalAgents.metadataSources,
  })
  const ptyStreamService = createPtyStreamService({
    token,
    webSessions,
    now: ctx.now,
    ptyRuntime,
    replayWindowMaxBytes: PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES,
    allowQueryToken: true,
  })
  const persistence = createLazyPersistenceStore({
    userDataPath: options.userDataPath,
    dbPath: options.dbPath,
    createPersistenceStore: options.createPersistenceStore,
  })
  const getPersistenceStore = persistence.getPersistenceStore
  const terminalRuntimeAvailability = new TerminalRuntimeAvailability()
  const ready = initializeTerminalRuntimeAvailability({
    getPersistenceStore,
    availability: terminalRuntimeAvailability,
  }).then(() => undefined)
  const terminalRecovery = createControlSurfaceTerminalRecoveryRuntime({
    enabled: !options.createPersistenceStore,
    userDataPath: options.userDataPath,
    dbPath: options.dbPath,
    getPersistenceStore,
    ptyRuntime,
    ptyStreamService,
  })
  const syncClients = new Set<ServerResponse>()
  const syncEventBuffer: SyncEventPayload[] = []
  const publishSyncEventToLiveClients = (payload: SyncEventPayload): number =>
    publishLiveSyncEvent({
      syncClients,
      payload,
      desktopSink: options.desktopSyncEventSink,
    })
  const controlSurface = createControlSurface()
  registerControlSurfaceHandlers(controlSurface, {
    approvedWorkspaces: options.approvedWorkspaces,
    userDataPath: options.userDataPath,
    topology,
    webSessions,
    getPersistenceStore,
    ptyRuntime,
    deleteEntry: options.deleteEntry,
    ptyStreamHub: ptyStreamService.hub,
    publishSyncEvent: publishSyncEventToLiveClients,
    closeWebsiteNode: options.closeWebsiteNode,
    endpointHealth,
    appVersion,
    onStatePersisted: terminalRecovery.onStatePersisted,
    restoreTerminalSession: terminalRecovery.restoreTerminalSession,
    terminalSpawnAdmission: terminalRuntimeAvailability,
    terminalRecoverySpawnAdmission: terminalRuntimeAvailability,
    agentProviderRegistry,
    terminalAgentActivity: terminalAgents.activity,
  })

  let closed = false
  let disposePromise: Promise<void> | null = null
  const listeners = new Set<ControlSurfaceHttpListener>()
  const acceptedRequests = new ControlSurfaceAcceptedRequestOwner()
  const beginShutdown = (): void => {
    if (closed) {
      return
    }
    closed = true
    // Accepted long operations outlive HTTP handlers, but not runtime shutdown authority.
    void managedSshOperations.dispose().catch(() => undefined)
    void managedSshRuntime.dispose().catch(() => undefined)
    terminalRuntimeAvailability.beginShutdown()
    ptyStreamService.freezeIngress()
    for (const client of syncClients) {
      try {
        client.end()
      } catch {
        // ignore
      }
    }
    syncClients.clear()
    listeners.forEach(listener => {
      void listener.stopAccepting({ drainTimeoutMs: 0 }).catch(() => undefined)
    })
  }

  const handleRequest = createControlSurfaceHttpRequestHandler({
    ctx,
    token,
    webSessions,
    controlSurface,
    getPersistenceStore,
    syncClients,
    syncEventBuffer,
    desktopSyncEventSink: options.desktopSyncEventSink,
    getWebAccessPolicy: () => webAccessPolicy,
    isRuntimeClosed: () => closed,
  })

  const runtime: ControlSurfaceHttpRuntime = {
    token,
    appVersion,
    ready,
    beginShutdown,
    registerHandlers: register => {
      if (closed || listeners.size > 0) {
        throw new Error('Control Surface handlers must be registered before listeners start.')
      }
      register(controlSurface)
    },
    listen: listenerOptions => {
      if (closed) {
        throw new Error('Control Surface runtime is closed.')
      }
      const listener = createControlSurfaceHttpListener({
        config: listenerOptions,
        isRuntimeClosed: () => closed,
        handleRequest,
        handleUpgrade: (req, socket, head, listenerConfig) => {
          ptyStreamService.handleUpgrade(req, socket, head, {
            listenerRole: listenerConfig.role,
            webAccessGeneration: listenerConfig.webAccessGeneration ?? null,
          })
        },
        onDisposed: disposed => {
          listeners.delete(disposed)
        },
        acceptedRequests,
      })
      listeners.add(listener)
      return listener
    },
    setWebAccessPolicy: policy => {
      webAccessPolicy = { ...policy }
      ctx.capabilities.webShell = policy.enabled
    },
    getWebAccessPolicy: () => ({ ...webAccessPolicy }),
    rotateWebSessionGeneration: () => webSessions.invalidateAll(),
    closePtyStreamClients: filter => ptyStreamService.closeClients(filter),
    getPtyStreamInstanceId: () => ptyStreamService.instanceId,
    dispose: async () => {
      if (disposePromise) {
        return await disposePromise
      }

      const retiringListeners = [...listeners]
      beginShutdown()
      disposePromise = (async () => {
        await Promise.all(
          retiringListeners.map(async listener => {
            await listener.stopAccepting()
            listener.closeStreamingClients()
          }),
        )
        await acceptedRequests.sealAndDrain()

        try {
          await terminalAgents.dispose()
        } catch {
          // ignore
        }

        await terminalRecovery.drainBeforeShutdown()

        try {
          ptyStreamService.dispose()
        } catch {
          // ignore
        }

        try {
          ptyRuntime.dispose()
          await ptyRuntime.drainLaunchArtifacts()
        } catch {
          // ignore
        }

        try {
          await managedSshOperations.dispose()
          await managedSshRuntime.dispose()
        } catch {
          // ignore
        }

        await terminalRecovery.dispose()

        try {
          await persistence.dispose()
        } catch {
          // ignore
        }
      })()

      return await disposePromise
    },
  }

  return runtime
}
