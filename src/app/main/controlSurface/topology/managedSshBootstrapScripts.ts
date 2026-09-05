import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'

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

printf '%s\\n' '[opencove-bootstrap-progress:v1] checking_remote_runtime'
force_reinstall=${shellQuote(options.reinstallRuntime ? '1' : '0')}
if [ "$force_reinstall" != "1" ] && worker_is_ready; then
  exit 0
fi

printf '%s\\n' '[opencove-bootstrap-progress:v1] checking_installation'
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
  printf '%s\\n' '[opencove-bootstrap-progress:v1] downloading_installer'
  if ! curl -fsSL "$installer_url" -o "$installer_path"; then
    printf '%s\\n' "[opencove-bootstrap:installer_unavailable] The OpenCove installer could not be downloaded. Verify the release asset exists and the remote host can reach: $installer_url" >&2
    tail -n 80 "$health_log" >&2 || true
    exit 127
  fi
  printf '%s\\n' '[opencove-bootstrap-progress:v1] installing_runtime'
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

printf '%s\\n' '[opencove-bootstrap-progress:v1] starting_runtime'
nohup opencove worker start --hostname 127.0.0.1 --port "$remote_port" --token="$remote_token" --user-data "$user_data_dir" > "$log_file" 2>&1 < /dev/null &

printf '%s\\n' '[opencove-bootstrap-progress:v1] waiting_for_runtime'
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

export function buildWindowsBootstrapScript(
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

[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] checking_remote_runtime')
if (-not $forceReinstall -and (& $workerIsReady)) {
  exit 0
}

[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] checking_installation')
$existing = Get-Command opencove -ErrorAction SilentlyContinue
if ($forceReinstall -or -not $existing) {
  [Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] downloading_installer')
  Invoke-RestMethod ${installerUrl} -OutFile $installerPath
  [Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] installing_runtime')
  powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
}

$existing = Get-Command opencove -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Error 'OpenCove remote runtime bootstrap did not make the opencove command available.'
}

[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] starting_runtime')
$args = @('worker', 'start', '--hostname', '127.0.0.1', '--port', '${remotePort}', ${tokenArgument}, '--user-data', $userDataDir)
Start-Process -FilePath $existing.Source -ArgumentList $args -RedirectStandardOutput $stdoutLogFile -RedirectStandardError $stderrLogFile -WindowStyle Hidden

[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] waiting_for_runtime')
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
