import { createManagedClaudeClearRuntime } from './managedClaudeClearRuntime'
import { createAgentSpawnRuntime } from './agentSpawnRuntime'
import { createCanvasSpawnRunner } from './createCanvasSpawnRunner'
import { createManagedClaudeDeliveryRuntime } from './managedClaudeDeliveryRuntime'
import { createWorkerAgentTurnArchiveRuntime } from './agentTurnArchiveRuntime'
import { withAgentRunBindings } from './agentRunStatePersistence'
import { createWorkerAgentRunState } from './ptyStream/ptyStreamAgentRunState'
import { createSessionGrantPtyRuntime } from './sessionGrantPtyRuntime'
import { resolveWorkerCliScriptPath } from '../../../shared/runtime/opencoveRuntimePaths'
import { PluginDistributionService } from '@contexts/plugins/application/PluginDistributionService'
import { GitPluginSources } from '@contexts/plugins/infrastructure/GitPluginSources'
import { registerPluginDistributionHandlers } from './handlers/pluginDistributionHandlers'
import { resolve } from 'node:path'
import { PluginInstallationManager } from '../../../contexts/plugins/application/PluginInstallationManager'
import { LocalPluginFiles } from '../../../contexts/plugins/infrastructure/LocalPluginFiles'
import { NodePluginBackend } from '../../../contexts/plugins/infrastructure/NodePluginBackend'
import { randomUUID } from 'node:crypto'
import { ManagedSshEndpointOperationOwner } from '../../../contexts/topology/application/ManagedSshEndpointOperationOwner'
import { createManagedSshOperationDiagnosticSink } from './topology/managedSshOperationDiagnostics'
import type { ServerResponse } from 'node:http'
import { createControlSurface } from './controlSurface'
import { WebSessionManager } from './http/webSessionManager'
import { createControlToken } from './http/createControlToken'
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
import { ManagedRuntimeMaintenance } from '../../../contexts/topology/application/ManagedRuntimeMaintenance'
import { registerManagedRuntimeHandlers } from './handlers/managedRuntimeHandlers'
import { PluginViewLifecycle } from './pluginViewLifecycle'
const PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES = 400_000
export function createControlSurfaceHttpRuntime(
  options: RegisterControlSurfaceHttpServerOptions,
): ControlSurfaceHttpRuntime {
  const instanceId = randomUUID()
  const turnArchive = createWorkerAgentTurnArchiveRuntime({
    enabled: options.enableAgentTurnArchive === true,
    userDataPath: options.userDataPath,
    getPersistenceStore: () => persistence.getPersistenceStore(),
    onNodesRemoved: ids => agentRuns.registry.revokeNodes(ids, false),
  })
  const agentRuns = createWorkerAgentRunState(
    instanceId,
    Date.now,
    options.enableAgentTurnArchive
      ? {
          archive: turnArchive.port,
          membership: turnArchive.membership,
          isRemote: turnArchive.isRemote,
        }
      : {},
  )
  agentRuns.registry.subscribe(
    { epoch: instanceId, afterSeq: 0 },
    { types: ['agent.state_changed'] },
    event => {
      if (event.type !== 'resync_required') {
        options.desktopPtyStateSink?.(agentRuns.project(event.snapshot))
      }
    },
  )
  const appVersion = normalizeControlSurfaceAppVersion(options.appVersion)
  const pluginFiles = new LocalPluginFiles(options.userDataPath, process.platform, appVersion)
  const plugins = new PluginInstallationManager({
    files: pluginFiles,
    backend: new NodePluginBackend(resolve(__dirname, 'pluginHost.js')),
    createId: randomUUID,
    reservedIds: [],
    scheduleViewExpiry: expire => {
      const timer = setTimeout(expire, 180_000)
      timer.unref()
      return () => clearTimeout(timer)
    },
  })
  const pluginDistribution = new PluginDistributionService(
    plugins,
    pluginFiles,
    new GitPluginSources(options.userDataPath),
  )
  const pluginViews = new PluginViewLifecycle(plugins)
  const token = options.token ?? createControlToken()
  const webSessions = new WebSessionManager(resolve(options.userDataPath))
  const clientLifetime = new AbortController()
  const ctx = createControlSurfaceHttpServerContext({
    signal: clientLifetime.signal,
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
    getPersistenceStore: () => getPersistenceStore(),
    userDataPath: options.userDataPath,
    agentHookChannels,
    agentProviderRegistry: options.agentProviderRegistry,
    appVersion,
    desktopMetadataSink: options.desktopPtyMetadataSink,
    disposeSessionStateWatcher: options.ptyRuntime.disposeSessionStateWatcher,
  })
  const agentProviderRegistry = terminalAgents.agentProviderRegistry
  let privateControlUrl = ''
  const spawnRuntime = createAgentSpawnRuntime(options.ptyRuntime)
  const sessionAccess = createSessionGrantPtyRuntime({
    runtime: spawnRuntime.runtime,
    onSpawnIdentity: (sessionId, nodeId) => agentRuns.captureLaunchIdentity(sessionId, nodeId),
    controlUrl: () => privateControlUrl,
    cliPath: resolveWorkerCliScriptPath(__dirname),
    ensureAssets: terminalAgents.ensureAssets,
  })
  const ptyRuntime = createMultiEndpointPtyRuntime({
    localRuntime: sessionAccess.runtime,
    topology,
    disposeLocalRuntime: options.ownsPtyRuntime === true,
    agentStateSources: terminalAgents.stateSources,
    agentMetadataSources: terminalAgents.metadataSources,
  })
  const ptyStreamService = createPtyStreamService({
    agentRuns,
    sessionGrants: sessionAccess.grants,
    token,
    webSessions,
    now: ctx.now,
    ptyRuntime,
    replayWindowMaxBytes: PTY_STREAM_DEFAULT_REPLAY_WINDOW_MAX_BYTES,
    allowQueryToken: true,
  })
  const persistence = createLazyPersistenceStore({
    strictRecovery: options.strictPersistence,
    userDataPath: options.userDataPath,
    dbPath: options.dbPath,
    createPersistenceStore: options.createPersistenceStore,
  })
  const agentClients = new Set<ServerResponse>()
  const { syncClients, syncEventBuffer, commitPublisher, managedClaude, getPersistenceStore } =
    createManagedClaudeDeliveryRuntime({
      getStore: withAgentRunBindings(turnArchive.getPersistenceStore, agentRuns),
      killExactRuntime: async id => {
        ptyRuntime.kill(id)
      },
      hasRuntime: id => ptyStreamService.hub.isSessionActive(id),
      desktopSink: options.desktopSyncEventSink,
      projectCommittedBinding: ({ binding }) => {
        if (binding.runtimeSessionId && binding.tuple.resumeSessionId) {
          ptyStreamService.hub.projectCommittedClaudeBinding(
            binding.runtimeSessionId,
            binding.tuple.resumeSessionId,
          )
        }
      },
    })
  const claudeClear = createManagedClaudeClearRuntime(agentHookChannels, managedClaude.owner)
  const terminalRuntimeAvailability = new TerminalRuntimeAvailability()
  let runtimeReady = false
  void plugins.start()
  const ready = (async () => {
    if (options.strictPersistence) {
      await (await getPersistenceStore()).readAppState()
    }
    await initializeTerminalRuntimeAvailability({
      getPersistenceStore,
      availability: terminalRuntimeAvailability,
    })
    await turnArchive.start()
    try {
      await managedClaude.ready()
    } catch (error) {
      // Nonstrict startup remains available with terminal admission closed. Launches still
      // require an authoritative store; warming the ownership coordinator cannot grant it.
      if (options.strictPersistence) {
        throw error
      }
    }
    runtimeReady = true
  })()
  const terminalRecovery = createControlSurfaceTerminalRecoveryRuntime({
    enabled: !options.createPersistenceStore,
    userDataPath: options.userDataPath,
    dbPath: options.dbPath,
    getPersistenceStore,
    ptyRuntime,
    ptyStreamService,
  })
  const publishSyncEventToLiveClients = (payload: SyncEventPayload): number =>
    publishLiveSyncEvent({
      syncClients,
      payload,
      desktopSink: options.desktopSyncEventSink,
    })
  const maintenance = options.deploymentId
    ? new ManagedRuntimeMaintenance(
        () => options.ptyRuntime.isIdle?.() === true && managedSshOperations.isIdle(),
        options.activationId ?? null,
      )
    : null
  const canvasSpawnRunner = createCanvasSpawnRunner({
    managedClaude,
    terminalRuntimeAvailability,
    getPersistenceStore,
  })
  const controlSurface = createControlSurface({
    run: (...args) => spawnRuntime.observeRequests(() => canvasSpawnRunner(...args)),
    enter: id =>
      maintenance &&
      !id.startsWith('worker.maintenance.') &&
      id !== 'system.capabilities' &&
      id !== 'system.ping'
        ? maintenance.enter()
        : undefined,
  })
  if (maintenance && options.requestManagedShutdown) {
    registerManagedRuntimeHandlers(controlSurface, {
      maintenance,
      instanceId,
      requestShutdown: options.requestManagedShutdown,
    })
  }
  registerPluginDistributionHandlers(controlSurface, pluginDistribution)
  registerControlSurfaceHandlers(controlSurface, {
    agentSpawnRuntime: spawnRuntime.port,
    context: ctx,
    plugins,
    pluginDistribution,
    deploymentId: options.deploymentId,
    instanceId,
    isReady: () => runtimeReady,
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
    cleanupUnreferencedSession: async id => {
      await managedClaude.ready()
      return managedClaude.owner.cleanup(id)
    },
    terminalAgentActivity: terminalAgents.activity,
  })
  let closed = false
  let disposePromise: Promise<void> | null = null
  const listeners = new Set<ControlSurfaceHttpListener>()
  const acceptedRequests = new ControlSurfaceAcceptedRequestOwner()
  let managedDrain: Promise<unknown> | undefined
  const beginShutdown = (): void => {
    if (closed) {
      return
    }
    closed = true
    clientLifetime.abort()
    const deadlineAt = performance.now() + 5000
    managedDrain = managedClaude
      .drainLaunches(deadlineAt)
      .then(() => claudeClear.drain(deadlineAt))
      .finally(() => {
        claudeClear.dispose()
        managedClaude.dispose()
        turnArchive.stop()
        sessionAccess.dispose()
        spawnRuntime.dispose()
      })
    plugins.beginShutdown()
    pluginViews.dispose()
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
    for (const client of agentClients) {
      client.end()
    }
    agentClients.clear()
    listeners.forEach(listener => {
      void listener.stopAccepting({ drainTimeoutMs: 0 }).catch(() => undefined)
    })
  }
  const handleRequest = createControlSurfaceHttpRequestHandler({
    sessionGrants: sessionAccess.grants,
    plugins,
    ctx,
    token,
    webSessions,
    controlSurface,
    // Revision probes must not hydrate agent bindings before operation admission.
    getPersistenceStore: persistence.getPersistenceStore,
    syncClients,
    syncEventBuffer,
    agentRuns: agentRuns.registry,
    agentClients,
    desktopSyncEventSink: options.desktopSyncEventSink,
    getWebAccessPolicy: () => webAccessPolicy,
    isRuntimeClosed: () => closed,
  })
  const runtime: ControlSurfaceHttpRuntime = {
    token,
    appVersion,
    agentTurnArchive: turnArchive.port,
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
          if (pluginViews.tryHandleUpgrade(req, socket, head)) {
            return
          }
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
      if (listenerOptions.role !== 'web') {
        void listener.ready
          .then(address => {
            const host =
              address.bindHostname === '0.0.0.0'
                ? '127.0.0.1'
                : address.bindHostname === '::'
                  ? '::1'
                  : address.bindHostname
            privateControlUrl = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
          })
          .catch(() => undefined)
      }
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
        await managedDrain
        await Promise.all(
          retiringListeners.map(async listener => {
            await listener.stopAccepting()
            listener.closeStreamingClients()
          }),
        )
        await acceptedRequests.sealAndDrain()
        await plugins.dispose()
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
          await ptyRuntime.dispose()
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
        turnArchive.dispose()
        try {
          commitPublisher.dispose()
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
