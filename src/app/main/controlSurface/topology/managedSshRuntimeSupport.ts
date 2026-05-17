import { runCommand } from '../../../../platform/process/runCommand'
import { readRuntimeAppVersion } from '../runtimeAppVersion'
import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'

type BootstrapRemotePlatform = 'posix' | 'windows'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}

function sanitizeRemotePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'endpoint'
}

function shouldEnableDevBootstrap(): boolean {
  return (
    process.env['NODE_ENV'] === 'development' ||
    process.env['NODE_ENV'] === 'test' ||
    process.env['OPENCOVE_ENABLE_MANAGED_SSH_DEV_BOOTSTRAP'] === '1'
  )
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

export function buildPosixBootstrapScript(
  access: ManagedSshEndpointRuntimeAccess,
  options: { installerUrl: string; reinstallRuntime: boolean; devRepoRoot?: string | null },
): string {
  const endpointSegment = sanitizeRemotePathSegment(access.endpointId)
  const remotePort = String(access.ssh.remotePort)
  const token = shellQuote(access.token)
  const installerUrl = shellQuote(options.installerUrl)
  const configuredDevRepoRoot = options.devRepoRoot ? shellQuote(options.devRepoRoot) : "''"
  const allowDevBootstrapExpression = shouldEnableDevBootstrap()
    ? `[ "${'${OPENCOVE_DISABLE_MANAGED_SSH_DEV_BOOTSTRAP:-0}'}" != "1" ]`
    : 'false'

  return `
set -eu
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

endpoint_id=${shellQuote(endpointSegment)}
remote_port=${shellQuote(remotePort)}
remote_token=${token}
state_dir="${'${XDG_STATE_HOME:-$HOME/.local/state}'}/opencove/managed-ssh/$endpoint_id"
user_data_dir="${'${XDG_CONFIG_HOME:-$HOME/.config}'}/opencove/managed-ssh/$endpoint_id"
log_file="$state_dir/managed-worker.log"
installer_path="$state_dir/opencove-install.sh"
mkdir -p "$state_dir" "$user_data_dir"

find_opencove_dev_repo_root() {
  configured_root=${configuredDevRepoRoot}
  env_root="${'${OPENCOVE_MANAGED_SSH_DEV_REPO_ROOT:-}'}"
  for repo_root in "$env_root" "$configured_root" "$HOME/opencove-wsl-deploy" "$HOME/opencove"; do
    if [ -n "$repo_root" ] && [ -f "$repo_root/out/main/worker.js" ]; then
      printf '%s\\n' "$repo_root"
      return 0
    fi
  done
  return 1
}

install_opencove_dev_wrapper() {
  repo_root="$(find_opencove_dev_repo_root)" || return 1
  cat > "$state_dir/opencove" <<'OPENCOVE_MANAGED_SSH_WRAPPER'
#!/bin/sh
set -eu
if [ "$#" -ge 2 ] && [ "$1" = "worker" ] && [ "$2" = "start" ]; then
  shift 2
  cd "$OPENCOVE_MANAGED_SSH_DEV_REPO_ROOT"
  exec node out/main/worker.js "$@"
fi
printf '%s\\n' "Unsupported OpenCove dev wrapper command: $*" >&2
exit 64
OPENCOVE_MANAGED_SSH_WRAPPER
  chmod +x "$state_dir/opencove"
  export OPENCOVE_MANAGED_SSH_DEV_REPO_ROOT="$repo_root"
  export PATH="$state_dir:$PATH"
}

if [ "${options.reinstallRuntime ? '1' : '0'}" = "1" ]; then
  rm -f "$state_dir/opencove"
fi

if ! command -v opencove >/dev/null 2>&1; then
  if ${allowDevBootstrapExpression}; then
    install_opencove_dev_wrapper || true
  fi
fi

if ! command -v opencove >/dev/null 2>&1; then
  curl -fsSL ${installerUrl} -o "$installer_path"
  sh "$installer_path"
fi

if ! command -v opencove >/dev/null 2>&1; then
  printf '%s\\n' 'OpenCove remote runtime bootstrap did not make the opencove command available.' >&2
  exit 127
fi

nohup opencove worker start --hostname 127.0.0.1 --port "$remote_port" --token "$remote_token" --user-data "$user_data_dir" > "$log_file" 2>&1 < /dev/null &

ready=0
attempt=0
while [ "$attempt" -lt 120 ]; do
  if curl -fsS -m 1 -X POST \\
    -H "authorization: Bearer ${access.token}" \\
    -H "content-type: application/json" \\
    --data '{"kind":"query","id":"system.ping","payload":null}' \\
    "http://127.0.0.1:${remotePort}/invoke" >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

if [ "$ready" != "1" ]; then
  printf '%s\\n' 'OpenCove worker did not become ready after SSH bootstrap.' >&2
  tail -n 80 "$log_file" >&2 || true
  exit 1
fi
`
}

function buildWindowsBootstrapScript(
  access: ManagedSshEndpointRuntimeAccess,
  options: { installerUrl: string; reinstallRuntime: boolean },
): string {
  const endpointSegment = powershellQuote(sanitizeRemotePathSegment(access.endpointId))
  const installerUrl = powershellQuote(options.installerUrl)
  const token = powershellQuote(access.token)
  const remotePort = String(access.ssh.remotePort)

  return `
$ErrorActionPreference = 'Stop'
$endpointId = ${endpointSegment}
$stateBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\\Local' }
$configBase = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $HOME 'AppData\\Roaming' }
$stateDir = Join-Path $stateBase (Join-Path 'OpenCove\\managed-ssh' $endpointId)
$userDataDir = Join-Path $configBase (Join-Path 'OpenCove\\managed-ssh' $endpointId)
$stdoutLogFile = Join-Path $stateDir 'managed-worker.out.log'
$stderrLogFile = Join-Path $stateDir 'managed-worker.err.log'
$installerPath = Join-Path $stateDir 'opencove-install.ps1'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null

$existing = Get-Command opencove -ErrorAction SilentlyContinue
if (${options.reinstallRuntime ? '$true' : '$false'} -or -not $existing) {
  Invoke-RestMethod ${installerUrl} -OutFile $installerPath
  powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
}

$existing = Get-Command opencove -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Error 'OpenCove remote runtime bootstrap did not make the opencove command available.'
}

$args = @('worker', 'start', '--hostname', '127.0.0.1', '--port', '${remotePort}', '--token', ${token}, '--user-data', $userDataDir)
Start-Process -FilePath $existing.Source -ArgumentList $args -RedirectStandardOutput $stdoutLogFile -RedirectStandardError $stderrLogFile -WindowStyle Hidden

$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  try {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:${remotePort}/invoke' -Headers @{ authorization = 'Bearer ${access.token}' } -ContentType 'application/json' -Body '{"kind":"query","id":"system.ping","payload":null}' -TimeoutSec 1 | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $ready) {
  Write-Error 'OpenCove worker did not become ready after SSH bootstrap.'
  if (Test-Path $stdoutLogFile) { Get-Content -Tail 80 $stdoutLogFile | Write-Error }
  if (Test-Path $stderrLogFile) { Get-Content -Tail 80 $stderrLogFile | Write-Error }
}
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
    devRepoRoot: process.env['OPENCOVE_MANAGED_SSH_DEV_REPO_ROOT'] ?? null,
  })
  const result = await runCommand(sshExecutablePath, buildSshArgs(access, ['sh']), process.cwd(), {
    timeoutMs: 120_000,
    stdin: script,
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.')
  }
}
