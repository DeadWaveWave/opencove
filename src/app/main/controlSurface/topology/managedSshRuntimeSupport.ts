import { runCommand } from '../../../../platform/process/runCommand'
import { readRuntimeAppVersion } from '../runtimeAppVersion'
import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'

type BootstrapRemotePlatform = 'posix' | 'windows'

function resolveSshDestination(access: ManagedSshEndpointRuntimeAccess): string {
  const username = access.ssh.username?.trim() ?? ''
  return username.length > 0 ? `${username}@${access.ssh.host}` : access.ssh.host
}

export function buildSshArgs(access: ManagedSshEndpointRuntimeAccess, extra: string[]): string[] {
  const args: string[] = []
  const sshPort = access.ssh.port
  if (typeof sshPort === 'number' && Number.isFinite(sshPort) && sshPort > 0) {
    args.push('-p', String(Math.floor(sshPort)))
  }

  return [...args, resolveSshDestination(access), ...extra]
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

function buildInstallerAssetUrl(platform: BootstrapRemotePlatform, version: string | null): string {
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

function buildPosixBootstrapScript(
  access: ManagedSshEndpointRuntimeAccess,
  options: { installerUrl: string; reinstallRuntime: boolean },
): string {
  const installGuard = options.reinstallRuntime
    ? `curl -fsSL '${options.installerUrl}' | sh`
    : `if ! command -v opencove >/dev/null 2>&1; then curl -fsSL '${options.installerUrl}' | sh; fi`

  return `
set -eu
export PATH="$HOME/.local/bin:$PATH"
${installGuard}
mkdir -p "${'${XDG_STATE_HOME:-$HOME/.local/state}'}"/opencove
nohup sh -lc 'export PATH="$HOME/.local/bin:$PATH"; opencove worker start --hostname 127.0.0.1 --port ${String(access.ssh.remotePort)} --token ${access.token}' > "${'${XDG_STATE_HOME:-$HOME/.local/state}'}"/opencove/managed-worker.log 2>&1 < /dev/null &
`
}

function buildWindowsBootstrapScript(
  access: ManagedSshEndpointRuntimeAccess,
  options: { installerUrl: string; reinstallRuntime: boolean },
): string {
  const installScript = options.reinstallRuntime
    ? `Invoke-RestMethod '${options.installerUrl}' | Invoke-Expression`
    : `
$existing = Get-Command opencove -ErrorAction SilentlyContinue
if (-not $existing) {
  Invoke-RestMethod '${options.installerUrl}' | Invoke-Expression
}
`

  return `
$ErrorActionPreference = 'Stop'
${installScript}
$logDir = Join-Path $env:LOCALAPPDATA 'OpenCove\\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$command = 'opencove worker start --hostname 127.0.0.1 --port ${String(access.ssh.remotePort)} --token ${access.token}'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $command -RedirectStandardOutput (Join-Path $logDir 'managed-worker.out.log') -RedirectStandardError (Join-Path $logDir 'managed-worker.err.log') -WindowStyle Hidden
`
}

async function classifyBootstrapPlatform(
  sshExecutablePath: string,
  access: ManagedSshEndpointRuntimeAccess,
): Promise<BootstrapRemotePlatform> {
  if (access.ssh.remotePlatform === 'posix' || access.ssh.remotePlatform === 'windows') {
    return access.ssh.remotePlatform
  }

  const posixProbe = await runCommand(
    sshExecutablePath,
    buildSshArgs(access, ['sh', '-lc', 'uname -s >/dev/null 2>&1 && printf posix']),
    process.cwd(),
    { timeoutMs: 10_000 },
  ).catch(() => null)
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
    { timeoutMs: 10_000 },
  ).catch(() => null)
  if (windowsProbe && windowsProbe.exitCode === 0) {
    return 'windows'
  }

  return 'posix'
}

export async function runManagedSshBootstrap(
  sshExecutablePath: string,
  access: ManagedSshEndpointRuntimeAccess,
  options?: { reinstallRuntime?: boolean },
): Promise<void> {
  const remotePlatform = await classifyBootstrapPlatform(sshExecutablePath, access)
  const installerUrl = buildInstallerAssetUrl(remotePlatform, readRuntimeAppVersion())
  if (remotePlatform === 'windows') {
    const script = buildWindowsBootstrapScript(access, {
      installerUrl,
      reinstallRuntime: options?.reinstallRuntime === true,
    })
    const result = await runCommand(
      sshExecutablePath,
      buildSshArgs(access, [
        'powershell',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '-',
      ]),
      process.cwd(),
      {
        timeoutMs: 120_000,
        stdin: script,
      },
    )
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.')
    }
    return
  }

  const script = buildPosixBootstrapScript(access, {
    installerUrl,
    reinstallRuntime: options?.reinstallRuntime === true,
  })
  const result = await runCommand(sshExecutablePath, buildSshArgs(access, ['sh']), process.cwd(), {
    timeoutMs: 120_000,
    stdin: script,
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.')
  }
}