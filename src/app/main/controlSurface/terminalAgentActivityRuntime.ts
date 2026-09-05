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
  agentHookChannels: readonly AgentHookChannel[]
  agentProviderRegistry?: AgentProviderRegistry
  appVersion?: string | null
  desktopMetadataSink?: (event: TerminalSessionMetadataEvent) => number
  desktopStateSink?: (event: TerminalSessionStateEvent) => number
  disposeSessionStateWatcher?: (sessionId: string) => void
}): {
  activity: TerminalAgentActivityEnvironmentService
  agentProviderRegistry: AgentProviderRegistry
  metadataSources: readonly Pick<AgentHookChannel, 'onMetadata'>[]
  stateSources: readonly Pick<AgentHookChannel, 'onState'>[]
  dispose: () => Promise<void>
} {
  const agentProviderRegistry =
    options.agentProviderRegistry ??
    new Registry(createBuiltinAgentProviderContributions({ appVersion: options.appVersion }))
  const invocationRegistry = new TerminalAgentInvocationRegistry()
  const gateway = new TerminalAgentActivityGateway({
    registry: invocationRegistry,
    resolveHookInjection: provider => agentProviderRegistry.require(provider).hookInjection ?? null,
  })
  const assets = new TerminalAgentTelemetryAssetStore({
    platform: process.platform,
    runtimeExecutable: process.execPath,
  })
  const activity = new TerminalAgentActivityEnvironmentService({
    assets,
    gateway,
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
