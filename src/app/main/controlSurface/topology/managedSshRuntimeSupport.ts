import { runCommand } from '../../../../platform/process/runCommand'
import type { ManagedSshStageFailureCode } from '../../../../shared/contracts/dto'
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
  const actionableDetail = detail.replaceAll(/\[opencove-bootstrap:[^\]]+\]\s*/g, '').trim()
  return new ManagedSshBootstrapError(failureKind, actionableDetail || 'Remote bootstrap failed.')
}

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
installer_url=${installerUrl}
state_dir="${'${XDG_STATE_HOME:-$HOME/.local/state}'}/opencove/managed-ssh/$endpoint_id"
user_data_dir="${'${XDG_CONFIG_HOME:-$HOME/.config}'}/opencove/managed-ssh/$endpoint_id"
log_file="$state_dir/managed-worker.log"
health_log="$state_dir/runtime-health.log"
installer_path="$state_dir/opencove-install.sh"
managed_launcher="${'${OPENCOVE_BIN_DIR:-$HOME/.local/bin}'}/opencove"
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

runtime_is_healthy() {
  : > "$health_log"
  if ! command -v opencove >/dev/null 2>&1; then
    printf '%s\\n' 'The opencove command is not available.' > "$health_log"
    return 1
  fi

  opencove worker start --help > "$health_log" 2>&1
}

worker_is_ready() {
  curl -fsS -m 1 -X POST \\
    -H "authorization: Bearer ${access.token}" \\
    -H "content-type: application/json" \\
    --data '{"kind":"query","id":"system.ping","payload":null}' \\
    "http://127.0.0.1:${remotePort}/invoke" >/dev/null 2>&1
}

prepare_repair_target() {
  resolved_launcher="$(command -v opencove 2>/dev/null || true)"
  if [ -z "$resolved_launcher" ]; then
    return 0
  fi

  if [ "$resolved_launcher" = "$state_dir/opencove" ]; then
    rm -f "$resolved_launcher"
    return 0
  fi

  if [ "$resolved_launcher" != "$managed_launcher" ] || \\
    ! grep -q '__OPENCOVE_CLI_WRAPPER__' "$resolved_launcher" 2>/dev/null; then
    printf '%s\\n' "[opencove-bootstrap:runtime_unmanaged] Refusing to replace the active opencove command because it is not an OpenCove-managed launcher: $resolved_launcher. Remove or repair that command, or set OPENCOVE_BIN_DIR to its OpenCove-managed location." >&2
    exit 127
  fi
}

force_reinstall=${shellQuote(options.reinstallRuntime ? '1' : '0')}
if [ "$force_reinstall" != "1" ] && worker_is_ready; then
  exit 0
fi

repair_needed=0
if [ "$force_reinstall" = "1" ] || ! runtime_is_healthy; then
  repair_needed=1
fi

if [ "$repair_needed" = "1" ]; then
  prepare_repair_target
  if ${allowDevBootstrapExpression}; then
    if install_opencove_dev_wrapper && runtime_is_healthy; then
      repair_needed=0
    fi
  fi
fi

if [ "$repair_needed" = "1" ]; then
  prepare_repair_target
  if ! curl -fsSL "$installer_url" -o "$installer_path"; then
    printf '%s\\n' "[opencove-bootstrap:installer_unavailable] The OpenCove installer could not be downloaded. Verify the release asset exists and the remote host can reach: $installer_url" >&2
    tail -n 80 "$health_log" >&2 || true
    exit 127
  fi
  if ! sh "$installer_path"; then
    printf '%s\\n' '[opencove-bootstrap:installer_unavailable] The OpenCove installer failed before the runtime became usable.' >&2
    tail -n 80 "$health_log" >&2 || true
    exit 127
  fi
fi

if ! runtime_is_healthy; then
  printf '%s\\n' '[opencove-bootstrap:runtime_corrupt] The OpenCove runtime failed its executable health check after one repair attempt.' >&2
  tail -n 80 "$health_log" >&2 || true
  exit 127
fi

nohup opencove worker start --hostname 127.0.0.1 --port "$remote_port" --token="$remote_token" --user-data "$user_data_dir" > "$log_file" 2>&1 < /dev/null &

ready=0
attempt=0
while [ "$attempt" -lt 120 ]; do
  if worker_is_ready; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.5
done

if [ "$ready" != "1" ]; then
  printf '%s\\n' '[opencove-bootstrap:runtime_start_failed] OpenCove worker did not become ready after SSH bootstrap.' >&2
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
  const tokenArgument = powershellQuote(`--token=${access.token}`)
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
$forceReinstall = ${options.reinstallRuntime ? '$true' : '$false'}
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null

$workerIsReady = {
  try {
    Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:${remotePort}/invoke' -Headers @{ authorization = 'Bearer ${access.token}' } -ContentType 'application/json' -Body '{"kind":"query","id":"system.ping","payload":null}' -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not $forceReinstall -and (& $workerIsReady)) {
  exit 0
}

$existing = Get-Command opencove -ErrorAction SilentlyContinue
if ($forceReinstall -or -not $existing) {
  Invoke-RestMethod ${installerUrl} -OutFile $installerPath
  powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
}

$existing = Get-Command opencove -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Error 'OpenCove remote runtime bootstrap did not make the opencove command available.'
}

$args = @('worker', 'start', '--hostname', '127.0.0.1', '--port', '${remotePort}', ${tokenArgument}, '--user-data', $userDataDir)
Start-Process -FilePath $existing.Source -ArgumentList $args -RedirectStandardOutput $stdoutLogFile -RedirectStandardError $stderrLogFile -WindowStyle Hidden

$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  if (& $workerIsReady) {
    $ready = $true
    break
  }
  Start-Sleep -Milliseconds 500
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
  options?: { reinstallRuntime?: boolean; appVersion?: string | null },
): Promise<void> {
  const remotePlatform = await classifyBootstrapPlatform(sshExecutablePath, access)
  const installerUrl = buildInstallerAssetUrl(remotePlatform, options?.appVersion ?? null)
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
      const detail = result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.'
      throw toManagedSshBootstrapError(detail)
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
    const detail = result.stderr.trim() || result.stdout.trim() || 'Remote bootstrap failed.'
    throw toManagedSshBootstrapError(detail)
  }
}
