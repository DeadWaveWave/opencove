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
import { randomUUID } from 'node:crypto'
import { getRuntimeBuildIdentity } from '../../../../shared/runtime/runtimeBuildIdentity'
import type { RuntimeBuildIdentity } from '../../../../shared/contracts/runtimeBuild'
import { redactManagedSshOutput } from './managedSshDiagnosticDetails'
import {
  transferManagedSshArtifact,
  resolveManagedSshArtifactName,
} from './managedSshArtifactTransfer'
import { withManagedSshArtifactRelay } from './managedSshArtifactRelay'
import { buildSshArgs } from './managedSshArgs'
export { buildSshArgs, buildSshTunnelArgs } from './managedSshArgs'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

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
  const managedCode =
    /\[opencove-bootstrap:(credential_mismatch|build_mismatch|runtime_busy|runtime_legacy|recovery_required|client_update_required|channel_conflict|conflicting_build|protocol_mismatch|checksum_failed|platform_unsupported)\]/.exec(
      detail,
    )?.[1]
  if (managedCode) {
    return managedCode as ManagedSshBootstrapFailureKind
  }
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
    runtimeBuild?: RuntimeBuildIdentity | null
    operationId?: string
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
  const runtimeBuild = options?.runtimeBuild ?? getRuntimeBuildIdentity()
  const operationId = options?.operationId ?? randomUUID()
  const installerUrl = buildInstallerAssetUrl(
    remotePlatform,
    runtimeBuild?.appVersion ?? options?.appVersion ?? null,
  )
  const cachedDevelopmentArtifact =
    runtimeBuild?.channel === 'dev'
      ? resolve(__dirname, '../../release/managed-ssh', runtimeBuild.buildId)
      : null
  const localArtifact =
    process.env.OPENCOVE_MANAGED_SSH_ARTIFACT_DIR ??
    (cachedDevelopmentArtifact && existsSync(cachedDevelopmentArtifact)
      ? cachedDevelopmentArtifact
      : null)
  const transfer = (directory: string) =>
    transferManagedSshArtifact({
      ssh: sshExecutablePath,
      access,
      directory,
      windows: remotePlatform === 'windows',
      operationId,
      signal: options?.signal,
    })
  const initialArtifactDirectory =
    localArtifact && (runtimeBuild?.channel !== 'dev' || options?.reinstallRuntime)
      ? await transfer(localArtifact)
      : null
  const execute = async (artifactDirectory: string | null) => {
    const scriptOptions = {
      installerUrl,
      reinstallRuntime: options?.reinstallRuntime === true,
      runtimeBuild,
      operationId,
      artifactDirectory,
    }
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
        timeoutMs: 600_000,
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
    return result
  }
  let result = await execute(initialArtifactDirectory)
  if (
    result.exitCode !== 0 &&
    localArtifact &&
    !initialArtifactDirectory &&
    classifyManagedSshBootstrapFailure(`${result.stderr}\n${result.stdout}`) ===
      'installer_unavailable'
  ) {
    result = await execute(await transfer(localArtifact))
  }
  if (
    result.exitCode !== 0 &&
    !localArtifact &&
    runtimeBuild &&
    runtimeBuild.channel !== 'dev' &&
    classifyManagedSshBootstrapFailure(`${result.stderr}\n${result.stdout}`) ===
      'installer_unavailable'
  ) {
    const assetName = await resolveManagedSshArtifactName({
      ssh: sshExecutablePath,
      access,
      windows: remotePlatform === 'windows',
      signal: options?.signal,
    })
    reportPhase('downloading_installer')
    result = await withManagedSshArtifactRelay(
      { installerUrl, assetName, windows: remotePlatform === 'windows', signal: options?.signal },
      async directory => {
        return await execute(await transfer(directory))
      },
    )
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.'
    throw toManagedSshBootstrapError(redactManagedSshOutput(detail, access.token))
  }
}
