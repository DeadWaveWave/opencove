import {
  buildPosixBootstrapScript,
  buildWindowsBootstrapScript,
} from './managedSshBootstrapScripts'
export {
  buildPosixBootstrapScript,
  buildWindowsBootstrapScript,
} from './managedSshBootstrapScripts'
import { runCommand } from '../../../../platform/process/runCommand'
import { createManagedSshBootstrapProgressParser } from './managedSshBootstrapProgress'
import type {
  ManagedSshEndpointOperationPhase,
  ManagedSshStageFailureCode,
} from '../../../../shared/contracts/dto'
import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'

type BootstrapRemotePlatform = 'posix' | 'windows'

export type ManagedSshBootstrapFailureKind = ManagedSshStageFailureCode

export class ManagedSshBootstrapError extends Error {
  readonly failureKind: ManagedSshBootstrapFailureKind

  constructor(failureKind: ManagedSshBootstrapFailureKind, message: string) {
    super(message)
    this.name = 'ManagedSshBootstrapError'
    this.failureKind = failureKind
  }
}

export function classifyManagedSshBootstrapFailure(detail: string): ManagedSshBootstrapFailureKind {
  if (detail.includes('[opencove-bootstrap:installer_unavailable]')) {
    return 'installer_unavailable'
  }

  if (detail.includes('[opencove-bootstrap:runtime_corrupt]')) {
    return 'runtime_corrupt'
  }

  if (detail.includes('[opencove-bootstrap:runtime_unmanaged]')) {
    return 'runtime_unmanaged'
  }

  if (detail.includes('[opencove-bootstrap:runtime_start_failed]')) {
    return 'runtime_start_failed'
  }

  return 'unknown'
}

function toManagedSshBootstrapError(detail: string): ManagedSshBootstrapError {
  const failureKind = classifyManagedSshBootstrapFailure(detail)
  const actionableDetail = detail
    .split(/\r?\n/)
    .filter(line => !line.includes('[opencove-bootstrap-progress:'))
    .join('\n')
    .replaceAll(/\[opencove-bootstrap:[^\]]+\]\s*/g, '')
    .trim()
  return new ManagedSshBootstrapError(failureKind, actionableDetail || 'Remote bootstrap failed.')
}

function resolveSshDestination(access: ManagedSshEndpointRuntimeAccess): string {
  const username = access.ssh.username?.trim() ?? ''
  return username.length > 0 ? `${username}@${access.ssh.host}` : access.ssh.host
}

function shouldForceIpv4ForLocalhost(access: ManagedSshEndpointRuntimeAccess): boolean {
  return access.ssh.host.trim().toLowerCase() === 'localhost'
}

function buildSshOptionArgs(access: ManagedSshEndpointRuntimeAccess): string[] {
  const args: string[] = []
  const sshPort = access.ssh.port
  if (typeof sshPort === 'number' && Number.isFinite(sshPort) && sshPort > 0) {
    args.push('-p', String(Math.floor(sshPort)))
  }
  if (shouldForceIpv4ForLocalhost(access)) {
    args.push('-o', 'AddressFamily=inet')
  }

  return args
}

export function buildSshArgs(access: ManagedSshEndpointRuntimeAccess, extra: string[]): string[] {
  return [...buildSshOptionArgs(access), resolveSshDestination(access), ...extra]
}

export function buildSshTunnelArgs(
  access: ManagedSshEndpointRuntimeAccess,
  options: string[],
): string[] {
  return [...buildSshOptionArgs(access), ...options, resolveSshDestination(access)]
}

function buildReleaseBaseUrl(version: string | null): string {
  const override = process.env['OPENCOVE_RELEASE_BASE_URL']?.trim()
  if (override) {
    return override
  }

  const normalizedVersion = version?.trim() ?? ''
  if (normalizedVersion.length === 0) {
    return 'https://github.com/DeadWaveWave/opencove/releases/latest/download'
  }

  return `https://github.com/DeadWaveWave/opencove/releases/download/v${normalizedVersion}`
}

export function buildInstallerAssetUrl(
  platform: BootstrapRemotePlatform,
  version: string | null,
): string {
  const ext = platform === 'windows' ? 'ps1' : 'sh'
  const baseUrl = buildReleaseBaseUrl(version)
  const normalizedVersion = version?.trim() ?? ''
  if (process.env['OPENCOVE_RELEASE_BASE_URL']?.trim()) {
    return `${baseUrl}/opencove-install.${ext}`
  }

  if (normalizedVersion.length === 0) {
    return `${baseUrl}/opencove-install.${ext}`
  }

  return `${baseUrl}/opencove-install-v${normalizedVersion}.${ext}`
}

async function classifyBootstrapPlatform(
  sshExecutablePath: string,
  access: ManagedSshEndpointRuntimeAccess,
  signal?: AbortSignal,
): Promise<BootstrapRemotePlatform> {
  if (access.ssh.remotePlatform === 'posix' || access.ssh.remotePlatform === 'windows') {
    return access.ssh.remotePlatform
  }

  const posixProbe = await runCommand(
    sshExecutablePath,
    buildSshArgs(access, ['sh', '-lc', 'uname -s >/dev/null 2>&1 && printf posix']),
    process.cwd(),
    { timeoutMs: 10_000, signal, captureMaxBytes: 262_144 },
  ).catch(error => {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error
    }
    return null
  })
  if (posixProbe && posixProbe.exitCode === 0 && posixProbe.stdout.trim() === 'posix') {
    return 'posix'
  }

  const windowsProbe = await runCommand(
    sshExecutablePath,
    buildSshArgs(access, [
      'powershell',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ]),
    process.cwd(),
    { timeoutMs: 10_000, signal, captureMaxBytes: 262_144 },
  ).catch(error => {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw error
    }
    return null
  })
  if (windowsProbe && windowsProbe.exitCode === 0) {
    return 'windows'
  }

  return 'posix'
}

export async function runManagedSshBootstrap(
  sshExecutablePath: string,
  access: ManagedSshEndpointRuntimeAccess,
  options?: {
    reinstallRuntime?: boolean
    appVersion?: string | null
    signal?: AbortSignal
    reportPhase?: (phase: ManagedSshEndpointOperationPhase) => void
  },
): Promise<void> {
  const reportPhase = (phase: ManagedSshEndpointOperationPhase): void => {
    if (!options?.signal?.aborted) {
      options?.reportPhase?.(phase)
    }
  }
  reportPhase('detecting_platform')
  const remotePlatform = await classifyBootstrapPlatform(sshExecutablePath, access, options?.signal)
  const installerUrl = buildInstallerAssetUrl(remotePlatform, options?.appVersion ?? null)
  const scriptOptions = { installerUrl, reinstallRuntime: options?.reinstallRuntime === true }
  const script =
    remotePlatform === 'windows'
      ? buildWindowsBootstrapScript(access, scriptOptions)
      : buildPosixBootstrapScript(access, {
          ...scriptOptions,
          devRepoRoot: process.env['OPENCOVE_MANAGED_SSH_DEV_REPO_ROOT'] ?? null,
        })
  const remoteCommand =
    remotePlatform === 'windows'
      ? ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-']
      : ['sh']
  // Streams must have separate partial-line buffers; their chunk boundaries are unrelated.
  const stdout = createManagedSshBootstrapProgressParser(reportPhase)
  const stderr = createManagedSshBootstrapProgressParser(reportPhase)
  const result = await runCommand(
    sshExecutablePath,
    buildSshArgs(access, remoteCommand),
    process.cwd(),
    {
      timeoutMs: 120_000,
      stdin: script,
      signal: options?.signal,
      captureMaxBytes: 262_144,
      onStdout: stdout.push,
      onStderr: stderr.push,
    },
  ).finally(() => {
    stdout.finish()
    stderr.finish()
  })
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.'
    throw toManagedSshBootstrapError(detail)
  }
}
