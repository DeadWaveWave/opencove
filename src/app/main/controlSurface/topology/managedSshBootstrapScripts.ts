import type { RuntimeBuildIdentity } from '../../../../shared/contracts/runtimeBuild'
import type { ManagedSshEndpointRuntimeAccess } from './topologyEndpointAccess'

export interface ManagedSshScriptOptions {
  installerUrl: string
  reinstallRuntime: boolean
  runtimeBuild?: RuntimeBuildIdentity | null
  operationId?: string
  artifactDirectory?: string | null
  devRepoRoot?: string | null
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
export function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}

function request(
  access: ManagedSshEndpointRuntimeAccess,
  options: ManagedSshScriptOptions,
): string {
  return JSON.stringify({
    endpointId: access.endpointId,
    port: access.ssh.remotePort,
    token: access.token,
    runtimeBuild: options.runtimeBuild ?? null,
    operationId: options.operationId ?? 'bootstrap',
  })
}

export function buildPosixBootstrapScript(
  access: ManagedSshEndpointRuntimeAccess,
  options: ManagedSshScriptOptions,
): string {
  const build = options.runtimeBuild
  if (!build) {
    return "printf '%s\\n' '[opencove-bootstrap:build_mismatch] Desktop build identity is missing; rebuild OpenCove.' >&2\nexit 1\n"
  }
  return `
set -eu
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
state_dir="${'${XDG_STATE_HOME:-$HOME/.local/state}'}/opencove/managed-ssh/${access.endpointId.replace(/[^A-Za-z0-9_-]/g, '_')}"
export OPENCOVE_INSTALL_ROOT="${'${XDG_DATA_HOME:-$HOME/.local/share}'}/opencove/managed-runtimes"
export OPENCOVE_BIN_DIR="$state_dir/builds/${build.buildId}/bin"
export OPENCOVE_RELEASE_BASE_URL=${shellQuote(options.installerUrl.slice(0, options.installerUrl.lastIndexOf('/')))}
launcher="$OPENCOVE_BIN_DIR/opencove"
installer_path="$state_dir/opencove-install-${options.operationId ?? 'bootstrap'}.sh"
mkdir -p "$state_dir"
printf '%s\\n' '[opencove-bootstrap-progress:v1] checking_remote_runtime'
printf '%s\\n' '[opencove-bootstrap-progress:v1] checking_installation'
runtime_matches() {
  [ -f "$launcher" ] && grep -q '__OPENCOVE_CLI_WRAPPER__' "$launcher" || return 1
  "$launcher" runtime inspect 2>/dev/null | grep -Fq ${shellQuote(`"buildId":"${build.buildId}"`)}
}
if [ ${options.reinstallRuntime ? '1' : '0'} = 1 ] || ! runtime_matches; then
  printf '%s\\n' '[opencove-bootstrap-progress:v1] downloading_installer'
  ${
    options.artifactDirectory
      ? `artifact_dir="$HOME/"${shellQuote(options.artifactDirectory)}
  cp "$artifact_dir/opencove-install.sh" "$installer_path"
  export OPENCOVE_STANDALONE_ASSET="$artifact_dir/$(cat "$artifact_dir/asset-name")"
  export OPENCOVE_STANDALONE_CHECKSUMS_FILE="$artifact_dir/SHA256SUMS.txt"`
      : build.channel === 'dev'
        ? `printf '%s\\n' '[opencove-bootstrap:installer_unavailable] No artifact for this development build. Build the target platform bundle and set OPENCOVE_MANAGED_SSH_ARTIFACT_DIR; historical source directories are not reused.' >&2
  exit 1`
        : `if ! curl -fsSL --connect-timeout 15 --max-time 60 ${shellQuote(options.installerUrl)} -o "$installer_path"; then
    printf '%s\\n' '[opencove-bootstrap:installer_unavailable] Could not download the pinned runtime installer.' >&2
    exit 1
  fi`
  }
  printf '%s\\n' '[opencove-bootstrap-progress:v1] installing_runtime'
  if ! sh "$installer_path"; then
    printf '%s\\n' '[opencove-bootstrap:installer_unavailable] Runtime installation failed.' >&2
    exit 1
  fi
fi
if ! runtime_matches; then
  printf '%s\\n' '[opencove-bootstrap:build_mismatch] Installed runtime does not match the Desktop build.' >&2
  exit 1
fi
printf '%s\\n' '[opencove-bootstrap-progress:v1] starting_runtime'
printf '%s' ${shellQuote(request(access, options))} | "$launcher" runtime prepare
`
}

export function buildWindowsBootstrapScript(
  access: ManagedSshEndpointRuntimeAccess,
  options: ManagedSshScriptOptions,
): string {
  const build = options.runtimeBuild
  if (!build) {
    return "throw '[opencove-bootstrap:build_mismatch] Desktop build identity is missing; rebuild OpenCove.'"
  }
  return `
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$stateBase = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $HOME 'AppData\\Local' }
$stateDir = Join-Path $stateBase ${powershellQuote(`OpenCove/managed-ssh/${access.endpointId.replace(/[^A-Za-z0-9_-]/g, '_')}`)}
$env:OPENCOVE_INSTALL_ROOT = Join-Path $stateBase 'OpenCove\\managed-runtimes'
$env:OPENCOVE_BIN_DIR = Join-Path $stateDir 'builds\\${build.buildId}\\bin'
$env:OPENCOVE_MANAGED_INSTALL = '1'
$env:OPENCOVE_RELEASE_BASE_URL = ${powershellQuote(options.installerUrl.slice(0, options.installerUrl.lastIndexOf('/')))}
$launcher = Join-Path $env:OPENCOVE_BIN_DIR 'opencove.cmd'
$installerPath = Join-Path $stateDir 'opencove-install-${options.operationId ?? 'bootstrap'}.ps1'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
function Test-RuntimeBuild {
  if (!(Test-Path -LiteralPath $launcher)) { return $false }
  $descriptor = & $launcher runtime inspect 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  try { return ($descriptor | ConvertFrom-Json).buildId -eq '${build.buildId}' } catch { return $false }
}
[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] checking_remote_runtime')
[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] checking_installation')
if (${options.reinstallRuntime ? '$true' : '$false'} -or !(Test-RuntimeBuild)) {
  [Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] downloading_installer')
  ${
    options.artifactDirectory
      ? `$artifactDir = Join-Path $HOME ${powershellQuote(options.artifactDirectory)}
  Copy-Item -LiteralPath (Join-Path $artifactDir 'opencove-install.ps1') -Destination $installerPath
  $env:OPENCOVE_STANDALONE_ASSET = Join-Path $artifactDir (Get-Content -LiteralPath (Join-Path $artifactDir 'asset-name') -Raw).Trim()
  $env:OPENCOVE_STANDALONE_CHECKSUMS_FILE = Join-Path $artifactDir 'SHA256SUMS.txt'`
      : build.channel === 'dev'
        ? `throw '[opencove-bootstrap:installer_unavailable] Build the target platform bundle and set OPENCOVE_MANAGED_SSH_ARTIFACT_DIR.'`
        : `try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Uri ${powershellQuote(options.installerUrl)} -OutFile $installerPath } catch { throw '[opencove-bootstrap:installer_unavailable] Could not download the pinned runtime installer.' }`
  }
  [Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] installing_runtime')
  & powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
  if ($LASTEXITCODE -ne 0) { throw '[opencove-bootstrap:installer_unavailable] Runtime installation failed.' }
}
if (!(Test-RuntimeBuild)) { throw '[opencove-bootstrap:build_mismatch] Installed runtime does not match the Desktop build.' }
[Console]::Out.WriteLine('[opencove-bootstrap-progress:v1] starting_runtime')
${powershellQuote(request(access, options))} | & $launcher runtime prepare
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
`
}
