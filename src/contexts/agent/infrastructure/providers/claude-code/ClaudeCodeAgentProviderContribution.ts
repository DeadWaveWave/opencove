import type { AgentHookChannel } from '../../../../../shared/runtime/agentHook/agentHookChannel'
import type {
  AgentProviderContribution,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import { buildAgentLaunchCommand } from '../../cli/AgentCommandFactory'
import { ExistingAgentProviderDetector } from '../shared/AgentProviderDetector'
import { createTemporaryProviderConfig } from '../shared/TemporaryProviderConfig'

export interface ClaudeCodeAgentProviderContributionOptions {
  readonly channel?: AgentHookChannel
  readonly detector?: AgentProviderDetector
  readonly runtimeExecutable?: string
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
  readonly launcher = {
    createLaunchPlan: async (command: CreateAgentLaunchPlanCommand) => {
      const telemetry = await this.prepareTelemetry(command)
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

  constructor(options: ClaudeCodeAgentProviderContributionOptions = {}) {
    this.channel = options.channel
    this.runtimeExecutable = options.runtimeExecutable ?? process.execPath
    this.detector = options.detector ?? new ExistingAgentProviderDetector(this.descriptor.id)
  }

  private async prepareTelemetry(command: CreateAgentLaunchPlanCommand) {
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
    const relay = await createTemporaryProviderConfig(
      'opencove-claude-hook-',
      'relay.mjs',
      claudeHookRelayScript,
    )
    command.artifacts.track('claude-hook-relay', relay)
    const settings = await createTemporaryProviderConfig(
      'opencove-claude-settings-',
      'settings.json',
      JSON.stringify({ hooks: createClaudeHooks(this.runtimeExecutable, [relay.path]) }),
    )
    command.artifacts.track('claude-hook-settings', settings)
    return {
      args: ['--settings', settings.path],
      env: {
        ...reservation.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      hookInstallState: reservation.installState,
      onStarted: reservation.commit,
    }
  }
}

function createClaudeHooks(command: string, args: readonly string[]) {
  const handler = { hooks: [{ args, command, type: 'command' }] }
  return {
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

const claudeHookRelayScript = [
  "let body='';",
  'for await (const chunk of process.stdin) body+=chunk;',
  'await fetch(process.env.OPENCOVE_CLAUDE_HOOK_ENDPOINT,{',
  'method:"POST",',
  'headers:{"content-type":"application/json","x-opencove-hook-token":process.env.OPENCOVE_CLAUDE_HOOK_TOKEN},',
  'body',
  '}).catch(()=>{});',
].join('')
