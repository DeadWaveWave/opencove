import { join } from 'node:path'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../platform/persistence/sqlite/normalize'
import { normalizeAgentSettings } from '../../../contexts/settings/domain/agentSettings'
import { appendBoundedRuntimeDiagnosticsLine } from '../../../platform/persistence/runtimeDiagnosticsFile'
import type { TerminalAgentDiagnosticSink } from '../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentDiagnostics'
import type {
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../../shared/contracts/dto'
import type { AgentProviderRegistry } from '../../../contexts/agent/application/services/AgentProviderRegistry'
import { AgentProviderRegistry as Registry } from '../../../contexts/agent/application/services/AgentProviderRegistry'
import { createBuiltinAgentProviderContributions } from '../../../contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import type { AgentHookChannel } from '../../../shared/runtime/agentHook/agentHookChannel'
import { TerminalAgentActivityGateway } from '../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityGateway'
import { TerminalAgentTelemetryAssetStore } from '../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore'
import { TerminalAgentActivityEnvironmentService } from '../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { TerminalAgentInvocationRegistry } from '../../../contexts/agent/application/TerminalAgentInvocationRegistry'

export function createTerminalAgentActivityRuntime(options: {
  userDataPath: string
  getPersistenceStore?: () => Promise<Pick<PersistenceStore, 'readAppState'>>
  agentHookChannels: readonly AgentHookChannel[]
  agentProviderRegistry?: AgentProviderRegistry
  appVersion?: string | null
  desktopMetadataSink?: (event: TerminalSessionMetadataEvent) => number
  desktopStateSink?: (event: TerminalSessionStateEvent) => number
  disposeSessionStateWatcher?: (sessionId: string) => void
}): {
  activity: TerminalAgentActivityEnvironmentService
  ensureAssets: () => Promise<
    import('../../../contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetStore').TerminalAgentTelemetryAssets
  >
  agentProviderRegistry: AgentProviderRegistry
  metadataSources: readonly Pick<AgentHookChannel, 'onMetadata'>[]
  stateSources: readonly Pick<AgentHookChannel, 'onState' | 'onClaudeTranscript'>[]
  dispose: () => Promise<void>
} {
  const agentProviderRegistry =
    options.agentProviderRegistry ??
    new Registry(createBuiltinAgentProviderContributions({ appVersion: options.appVersion }))
  for (const channel of options.agentHookChannels) {
    channel.setResidentContextEnabled?.(async () => {
      const store = await options.getPersistenceStore?.()
      const persisted = store ? normalizePersistedAppState(await store.readAppState()) : null
      return normalizeAgentSettings(persisted?.settings).agentResidentContext !== 'off'
    })
  }
  const invocationRegistry = new TerminalAgentInvocationRegistry()
  const gateway = new TerminalAgentActivityGateway({
    registry: invocationRegistry,
    resolveCodexReuseRunningAppServer: async () => {
      const store = await options.getPersistenceStore?.()
      const persisted = store ? normalizePersistedAppState(await store.readAppState()) : null
      return normalizeAgentSettings(persisted?.settings).codexReuseRunningAppServer
    },
    resolveHookInjection: provider => agentProviderRegistry.require(provider).hookInjection ?? null,
  })
  const diagnostic: TerminalAgentDiagnosticSink = event => {
    appendBoundedRuntimeDiagnosticsLine(
      join(options.userDataPath, 'logs', 'runtime-diagnostics.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        source: 'terminal-agent',
        event: event.type,
        details: event,
      }),
    )
  }
  const assets = new TerminalAgentTelemetryAssetStore({
    platform: process.platform,
    runtimeExecutable: process.execPath,
    parentDirectory: join(options.userDataPath, 'runtime', 'terminal-agent'),
    trustedDirectory: options.userDataPath,
    diagnostic,
  })
  const activity = new TerminalAgentActivityEnvironmentService({
    assets,
    gateway,
    diagnostic,
    inheritedPath: process.env.PATH ?? '',
    inheritedShell: process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'),
    platform: process.platform,
  })
  const metadataSources = [...options.agentHookChannels, invocationRegistry]
  const hookStart = Promise.all(
    options.agentHookChannels.map(async channel => await channel.start()),
  )
  const stateSubscriptions = options.desktopStateSink
    ? options.agentHookChannels.map(channel => channel.onState(options.desktopStateSink!))
    : []
  const metadataSubscriptions = metadataSources.map(source =>
    source.onMetadata(event => {
      if (event.piSnapshot) {
        options.disposeSessionStateWatcher?.(event.sessionId)
      }
      options.desktopMetadataSink?.(event)
    }),
  )

  return {
    activity,
    ensureAssets: () => assets.ensure(),
    agentProviderRegistry,
    metadataSources,
    stateSources: options.agentHookChannels,
    dispose: async () => {
      await hookStart.catch(() => undefined)
      stateSubscriptions.forEach(dispose => dispose())
      metadataSubscriptions.forEach(dispose => dispose())
      await gateway.dispose().catch(() => undefined)
      await Promise.all(
        options.agentHookChannels.map(
          async channel => await channel.dispose().catch(() => undefined),
        ),
      )
      await assets.dispose().catch(() => undefined)
    },
  }
}
