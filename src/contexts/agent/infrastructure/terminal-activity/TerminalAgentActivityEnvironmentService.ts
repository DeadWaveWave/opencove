import { posix, win32, type PlatformPath } from 'node:path'
import type { TerminalAgentActivityGateway } from './TerminalAgentActivityGateway'
import type { TerminalAgentGatewayReservation } from './TerminalAgentActivityGateway'
import type {
  TerminalAgentTelemetryAssetStore,
  TerminalAgentTelemetryAssets,
} from './TerminalAgentTelemetryAssetStore'

export interface PrepareTerminalAgentActivityCommand {
  args: readonly string[]
  command: string
  cwd: string
  environment: Readonly<NodeJS.ProcessEnv> | undefined
  interactiveShell: boolean
}

export interface PreparedTerminalAgentActivityEnvironment {
  args: readonly string[]
  command: string
  environment: NodeJS.ProcessEnv | undefined
  commit: (sessionId: string) => void
  dispose: () => Promise<void>
}

export class TerminalAgentActivityEnvironmentService {
  private readonly inheritedPath: string
  private readonly path: PlatformPath

  public constructor(
    private readonly options: {
      assets: TerminalAgentTelemetryAssetStore
      gateway: TerminalAgentActivityGateway
      inheritedPath: string
      inheritedShell: string
      platform: NodeJS.Platform
    },
  ) {
    this.inheritedPath = options.inheritedPath
    this.path = options.platform === 'win32' ? win32 : posix
  }

  public async prepare(
    command: PrepareTerminalAgentActivityCommand,
  ): Promise<PreparedTerminalAgentActivityEnvironment> {
    let reservation: TerminalAgentGatewayReservation | null = null
    try {
      const assets = await this.options.assets.ensure()
      reservation = await this.options.gateway.reserveTerminal()
      return this.createPrepared(command, assets, reservation)
    } catch {
      await reservation?.dispose().catch(() => undefined)
      return unchanged(command)
    }
  }

  private createPrepared(
    command: PrepareTerminalAgentActivityCommand,
    assets: TerminalAgentTelemetryAssets,
    reservation: TerminalAgentGatewayReservation,
  ): PreparedTerminalAgentActivityEnvironment {
    const environment = normalizeEnvironment(command.environment, this.options.platform)
    const currentPath = readPath(command.environment, this.options.platform) ?? this.inheritedPath
    environment.PATH = prependUniquePath(currentPath, assets.shimDirectory, this.path)
    environment.OPENCOVE_TERMINAL_AGENT_ENDPOINT = reservation.endpoint
    environment.OPENCOVE_TERMINAL_AGENT_TOKEN = reservation.token
    environment.OPENCOVE_TERMINAL_AGENT_SHIM_DIRECTORY = assets.shimDirectory

    const isSupportedShell =
      this.options.platform !== 'win32' &&
      command.interactiveShell &&
      isSupportedPosixInteractiveShell(command.command, this.path)
    if (isSupportedShell) {
      environment.OPENCOVE_TERMINAL_AGENT_BASH_RC = assets.bashRcPath
      environment.OPENCOVE_TERMINAL_AGENT_ORIGINAL_ZDOTDIR = environment.ZDOTDIR ?? ''
      environment.OPENCOVE_TERMINAL_AGENT_REAL_SHELL =
        command.command || this.options.inheritedShell
      environment.OPENCOVE_TERMINAL_AGENT_ZSH_DOT_DIRECTORY = assets.zshDotDirectory
    }

    return {
      args: command.args,
      command: isSupportedShell ? assets.shellLauncherPath : command.command,
      environment,
      commit: reservation.commit,
      dispose: reservation.dispose,
    }
  }
}

function unchanged(
  command: PrepareTerminalAgentActivityCommand,
): PreparedTerminalAgentActivityEnvironment {
  return {
    args: command.args,
    command: command.command,
    environment: command.environment ? { ...command.environment } : undefined,
    commit: () => undefined,
    dispose: async () => undefined,
  }
}

function isSupportedPosixInteractiveShell(shell: string, path: PlatformPath): boolean {
  const name = path.basename(shell).toLowerCase()
  return name === 'bash' || name === 'zsh'
}

function prependUniquePath(currentPath: string, directory: string, path: PlatformPath): string {
  const normalizedDirectory = normalizePath(directory, path)
  const entries = currentPath
    .split(path.delimiter)
    .filter(Boolean)
    .filter(entry => normalizePath(entry, path) !== normalizedDirectory)
  return [directory, ...entries].join(path.delimiter)
}

function normalizePath(value: string, path: PlatformPath): string {
  const resolved = path.resolve(value)
  return path === win32 ? resolved.toLowerCase() : resolved
}

function readPath(
  environment: Readonly<NodeJS.ProcessEnv> | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  if (!environment) {
    return undefined
  }
  if (platform !== 'win32') {
    return environment.PATH
  }
  const key = Object.keys(environment).find(candidate => candidate.toLowerCase() === 'path')
  return key ? environment[key] : undefined
}

function normalizeEnvironment(
  environment: Readonly<NodeJS.ProcessEnv> | undefined,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const normalized = { ...environment }
  if (platform === 'win32') {
    for (const key of Object.keys(normalized)) {
      if (key.toLowerCase() === 'path') {
        delete normalized[key]
      }
    }
  }
  return normalized
}
