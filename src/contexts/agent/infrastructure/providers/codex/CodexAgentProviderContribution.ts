import { connect } from 'node:net'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AgentHookChannel } from '../../../../../shared/runtime/agentHook/agentHookChannel'
import type {
  AgentProviderContribution,
  AgentProviderDetector,
  CreateAgentLaunchPlanCommand,
} from '../../../application/ports/AgentProviderContribution'
import { buildAgentLaunchCommand } from '../../cli/AgentCommandFactory'
import { ExistingAgentProviderDetector } from '../shared/AgentProviderDetector'
import { createAgentHookRelay, type AgentHookRelayInvocation } from '../shared/AgentHookRelay'
import { resolveCodexHookTrust, type CodexHookTrustResolver } from './CodexHookTrustResolver'
import { serializeCodexTomlString, serializeCodexTomlStringArray } from './CodexTomlConfiguration'

const codexDaemonSocketConnectTimeoutMs = 50

const codexHookEvents = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
] as const

export interface CodexAgentProviderContributionOptions {
  readonly channel?: AgentHookChannel
  readonly clientVersion?: string | null
  readonly detector?: AgentProviderDetector
  readonly hookTrustResolver?: CodexHookTrustResolver
  readonly runtimeExecutable?: string
  readonly runtimePlatform?: NodeJS.Platform
}

export class CodexAgentProviderContribution implements AgentProviderContribution {
  readonly descriptor = {
    displayName: 'Codex',
    documentationUrl: 'https://developers.openai.com/codex/cli/',
    id: 'codex',
    launch: {
      defaultArguments: [],
      defaultEnvironment: {},
      executable: 'codex',
      permission: { arguments: ['--dangerously-bypass-approvals-and-sandbox'] },
    },
  } as const
  readonly detector: AgentProviderDetector
  readonly hookInjection = {
    prepareHookInjection: async (
      command: Parameters<CodexAgentProviderContribution['prepareTelemetry']>[0],
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
  private readonly clientVersion: string
  private readonly hookTrustResolver: CodexHookTrustResolver
  private readonly runtimeExecutable: string
  private readonly runtimePlatform: NodeJS.Platform

  constructor(options: CodexAgentProviderContributionOptions = {}) {
    this.channel = options.channel
    this.clientVersion = normalizeCodexClientVersion(options.clientVersion)
    this.hookTrustResolver = options.hookTrustResolver ?? resolveCodexHookTrust
    this.runtimeExecutable = options.runtimeExecutable ?? process.execPath
    this.runtimePlatform = options.runtimePlatform ?? process.platform
    this.detector = options.detector ?? new ExistingAgentProviderDetector(this.descriptor.id)
  }

  private async prepareTelemetry(
    command: Pick<
      CreateAgentLaunchPlanCommand,
      'artifacts' | 'executablePathOverride' | 'workspaceDirectory'
    > & { readonly environment?: Readonly<NodeJS.ProcessEnv> },
  ) {
    if (!this.channel) {
      return { args: [], env: {}, hookInstallState: 'not_installed' as const }
    }
    const reservation = await this.channel.reserveSpawn()
    if (!reservation.usesHook) {
      return { args: [], env: {}, hookInstallState: reservation.installState }
    }
    if (await shouldDeferToCodexDaemon(command.environment ?? {})) {
      // Codex only reuses the implicit local app-server daemon when the CLI carries no
      // --config overrides, and the running daemon cannot adopt this invocation's hook
      // configuration, so keep the launch override-free and run telemetry degraded (#375).
      command.artifacts.track('codex-hook-reservation', reservation)
      return {
        args: [],
        env: reservation.env ?? {},
        hookInstallState: 'skipped' as const,
        onStarted: reservation.commit,
      }
    }
    command.artifacts.track('codex-hook-reservation', reservation)
    const relay = await createAgentHookRelay({
      provider: 'codex',
      runtimeExecutable: this.runtimeExecutable,
      runtimePlatform: this.runtimePlatform,
      artifacts: command.artifacts,
    })
    const hook = createCodexHooks(relay, this.runtimePlatform)
    let trust: string | null = null
    try {
      trust = await this.hookTrustResolver({
        clientVersion: this.clientVersion,
        executable: command.executablePathOverride ?? this.descriptor.launch.executable,
        environment: command.environment,
        hookCommand: hook.command,
        hookConfigurations: hook.configurations,
        workspaceDirectory: command.workspaceDirectory,
      })
    } catch {
      // Older Codex versions retain the legacy notify integration below.
    }
    const notify = `notify=${serializeCodexTomlStringArray(
      [relay.command, ...relay.args],
      this.runtimePlatform,
    )}`
    return {
      args: [
        ...(trust ? hook.configurations.flatMap(configuration => ['--config', configuration]) : []),
        ...(trust ? ['--config', trust] : []),
        '--config',
        notify,
      ],
      env: { ...reservation.env },
      hookInstallState: reservation.installState,
      onStarted: reservation.commit,
    }
  }
}

function normalizeCodexClientVersion(value: string | null | undefined): string {
  const normalized = value?.trim() ?? ''
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(normalized) ? normalized : '0.0.0'
}

function resolveCodexHome(environment: Readonly<NodeJS.ProcessEnv>): string | null {
  const override = environment.CODEX_HOME?.trim()
  if (override) {
    return isAbsolute(override) ? override : null
  }
  const home = homedir()
  return home ? join(home, '.codex') : null
}

function canConnectToCodexDaemonSocket(socketPath: string): Promise<boolean> {
  return new Promise(resolveCanConnect => {
    const socket = connect(socketPath)
    const finish = (canConnect: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolveCanConnect(canConnect)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(codexDaemonSocketConnectTimeoutMs, () => finish(false))
  })
}

async function shouldDeferToCodexDaemon(
  environment: Readonly<NodeJS.ProcessEnv>,
): Promise<boolean> {
  if (process.platform === 'win32') {
    return false
  }
  const codexHome = resolveCodexHome(environment)
  if (!codexHome) {
    return false
  }
  const socketPath = join(codexHome, 'app-server-control', 'app-server-control.sock')
  return canConnectToCodexDaemonSocket(socketPath)
}

function createCodexHooks(relay: AgentHookRelayInvocation, runtimePlatform: NodeJS.Platform) {
  const command = relay.shellCommand
  const serialize = (value: string): string => serializeCodexTomlString(value, runtimePlatform)
  const handler = [
    `{hooks=[{type=${serialize('command')},command=${serialize(command)},`,
    ...(runtimePlatform === 'win32' ? [`commandWindows=${serialize(command)},`] : []),
    'timeout=3}]}',
  ].join('')
  return {
    command,
    configurations: codexHookEvents.map(eventName => `hooks.${eventName}=[${handler}]`),
  }
}
