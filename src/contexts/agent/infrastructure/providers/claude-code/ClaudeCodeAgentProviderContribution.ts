import type { AgentHookChannel } from '../../../../../shared/runtime/agentHook/agentHookChannel'
import type {
  AgentProviderContribution,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import { buildAgentLaunchCommand } from '../../cli/AgentCommandFactory'
import { ExistingAgentProviderDetector } from '../shared/AgentProviderDetector'
import { createAgentHookRelay } from '../shared/AgentHookRelay'
import { createTemporaryProviderConfig } from '../shared/TemporaryProviderConfig'

export interface ClaudeCodeAgentProviderContributionOptions {
  readonly channel?: AgentHookChannel
  readonly detector?: AgentProviderDetector
  readonly runtimeExecutable?: string
  readonly runtimePlatform?: NodeJS.Platform
}

export class ClaudeCodeAgentProviderContribution implements AgentProviderContribution {
  readonly descriptor = {
    displayName: 'Claude Code',
    documentationUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    id: 'claude-code',
    launch: {
      defaultArguments: [],
      defaultEnvironment: {},
      executable: 'claude',
      permission: { arguments: ['--dangerously-skip-permissions'] },
    },
  } as const
  readonly detector: AgentProviderDetector
  readonly hookInjection = {
    prepareHookInjection: async (
      command: Parameters<ClaudeCodeAgentProviderContribution['prepareTelemetry']>[0],
    ) => await this.prepareTelemetry(command),
  }
  readonly launcher = {
    createLaunchPlan: async (command: CreateAgentLaunchPlanCommand) => {
      const telemetry = await this.hookInjection.prepareHookInjection(command)
      const plan = buildAgentLaunchCommand({
        provider: this.descriptor.id,
        mode: command.mode,
        prompt: command.prompt,
        model: command.model,
        resumeSessionId: command.resumeSessionId,
        agentFullAccess: command.agentFullAccess,
        injectedArgs: telemetry.args,
      })
      return {
        ...plan,
        env: telemetry.env,
        hookInstallState: telemetry.hookInstallState,
        ...(telemetry.onStarted ? { onStarted: telemetry.onStarted } : {}),
      }
    },
  }

  private readonly channel?: AgentHookChannel
  private readonly runtimeExecutable: string
  private readonly runtimePlatform: NodeJS.Platform

  constructor(options: ClaudeCodeAgentProviderContributionOptions = {}) {
    this.channel = options.channel
    this.runtimeExecutable = options.runtimeExecutable ?? process.execPath
    this.runtimePlatform = options.runtimePlatform ?? process.platform
    this.detector = options.detector ?? new ExistingAgentProviderDetector(this.descriptor.id)
  }

  private async prepareTelemetry(
    command: Pick<
      CreateAgentLaunchPlanCommand,
      'artifacts' | 'executablePathOverride' | 'workspaceDirectory'
    >,
  ) {
    if (!this.channel) {
      return { args: [], env: {}, hookInstallState: 'not_installed' as const }
    }
    const reservation = await this.channel.reserveSpawn()
    if (!reservation.usesHook) {
      return {
        args: [],
        env: {},
        hookInstallState: reservation.installState,
      }
    }
    command.artifacts.track('claude-hook-reservation', reservation)
    const relay = await createAgentHookRelay({
      provider: 'claude',
      runtimeExecutable: this.runtimeExecutable,
      runtimePlatform: this.runtimePlatform,
      artifacts: command.artifacts,
    })
    const settings = await createTemporaryProviderConfig(
      'opencove-claude-settings-',
      'settings.json',
      JSON.stringify({ hooks: createClaudeHooks(relay.command, relay.args) }),
    )
    command.artifacts.track('claude-hook-settings', settings)
    return {
      args: ['--settings', settings.path],
      env: { ...reservation.env },
      hookInstallState: reservation.installState,
      onStarted: reservation.commit,
    }
  }
}

function createClaudeHooks(command: string, args: readonly string[]) {
  const handler = { hooks: [{ args, command, type: 'command', timeout: 3 }] }
  return {
    SessionStart: [handler],
    Notification: [handler],
    PermissionDenied: [handler],
    PermissionRequest: [handler],
    PostToolUse: [handler],
    PostToolUseFailure: [handler],
    PreToolUse: [handler],
    SessionEnd: [handler],
    Stop: [handler],
    StopFailure: [handler],
    UserPromptSubmit: [handler],
  }
}
