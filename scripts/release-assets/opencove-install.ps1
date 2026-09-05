param(
  [switch]$Uninstall,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
  Write-Output 'Usage: opencove-install.ps1 [-Uninstall]'
  exit 0
}

$Owner = if ($env:OPENCOVE_RELEASE_OWNER) { $env:OPENCOVE_RELEASE_OWNER } else { 'DeadWaveWave' }
$Repo = if ($env:OPENCOVE_RELEASE_REPO) { $env:OPENCOVE_RELEASE_REPO } else { 'opencove' }
$ReleaseBaseUrl = if ($env:OPENCOVE_RELEASE_BASE_URL) {
  $env:OPENCOVE_RELEASE_BASE_URL
} else {
  "https://github.com/$Owner/$Repo/releases/latest/download"
}
$ChecksumsUrl = "$ReleaseBaseUrl/SHA256SUMS.txt"
$LocalAppData = if ($env:LOCALAPPDATA) {
  $env:LOCALAPPDATA
} else {
  Join-Path $HOME 'AppData\Local'
}
$InstallRoot = if ($env:OPENCOVE_INSTALL_ROOT) {
  $env:OPENCOVE_INSTALL_ROOT
} else {
  Join-Path $LocalAppData 'OpenCove\standalone'
}
$BinDir = if ($env:OPENCOVE_BIN_DIR) {
  $env:OPENCOVE_BIN_DIR
} else {
  Join-Path $LocalAppData 'OpenCove\bin'
}
$LauncherPath = Join-Path $BinDir 'opencove.cmd'
$CliWrapperMarker = '__OPENCOVE_CLI_WRAPPER__'
$CliWrapperOwnerKey = 'OPENCOVE_INSTALL_OWNER'
$CliWrapperOwnerStandalone = 'standalone'

function Normalize-PathSegment([string]$Value) {
  return $Value.Trim().TrimEnd('\', '/').ToLowerInvariant()
}

function Split-PathValue([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return @()
  }

  return @($Value -split ';' | Where-Object { $_.Trim().Length -gt 0 })
}

function Set-OpenCoveUserPath([string]$TargetPath, [string]$Action) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $segments = Split-PathValue $current
  $normalizedTarget = Normalize-PathSegment $TargetPath
  $nextSegments = @()

  foreach ($segment in $segments) {
    if ((Normalize-PathSegment $segment) -ne $normalizedTarget) {
      $nextSegments += $segment
    }
  }

  if ($Action -eq 'add') {
    $nextSegments += $TargetPath
  }

  [Environment]::SetEnvironmentVariable('Path', ($nextSegments -join ';'), 'User')

  $processSegments = Split-PathValue $env:Path
  $nextProcessSegments = @()
  foreach ($segment in $processSegments) {
    if ((Normalize-PathSegment $segment) -ne $normalizedTarget) {
      $nextProcessSegments += $segment
    }
  }
  if ($Action -eq 'add') {
    $nextProcessSegments += $TargetPath
  }
  $env:Path = $nextProcessSegments -join ';'
}

function Test-OwnedLauncher([string]$Path) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }

  $content = Get-Content -LiteralPath $Path -Raw
  return $content.Contains($CliWrapperMarker)
}

function Get-LauncherMetadataValue([string]$Path, [string]$Key) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }

  $prefix = "$Key="
  foreach ($line in Get-Content -LiteralPath $Path) {
    $candidate = $line.Trim() -replace '^(?:#|@?rem|::)\s*', ''
    if ($candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
      return $candidate.Substring($prefix.Length).Trim()
    }
  }

  return $null
}

function Test-StandaloneLauncher([string]$Path) {
  if (!(Test-OwnedLauncher $Path)) {
    return $false
  }

  $owner = Get-LauncherMetadataValue $Path $CliWrapperOwnerKey
  if ($owner -eq $CliWrapperOwnerStandalone) {
    return $true
  }

  if (![string]::IsNullOrWhiteSpace($owner)) {
    return $false
  }

  $runtimeBin = Get-LauncherMetadataValue $Path 'OPENCOVE_NODE_BIN'
  if ([string]::IsNullOrWhiteSpace($runtimeBin)) {
    $runtimeBin = Get-LauncherMetadataValue $Path 'OPENCOVE_ELECTRON_BIN'
  }
  if ([string]::IsNullOrWhiteSpace($runtimeBin)) {
    return $false
  }

  $normalizedRuntimeBin = Normalize-PathSegment $runtimeBin
  $normalizedInstallRoot = Normalize-PathSegment $InstallRoot
  return $normalizedRuntimeBin.StartsWith("$normalizedInstallRoot\", [StringComparison]::OrdinalIgnoreCase)
}

function Remove-OpenCoveStandalone {
  $shouldRemovePath = $true
  if (Test-Path -LiteralPath $LauncherPath -PathType Leaf) {
    if (!(Test-OwnedLauncher $LauncherPath)) {
      throw "Refusing to remove existing non-OpenCove launcher at $LauncherPath"
    }

    if (Test-StandaloneLauncher $LauncherPath) {
      Remove-Item -LiteralPath $LauncherPath -Force
      Write-Output "Removed OpenCove CLI launcher at $LauncherPath"
    } else {
      $shouldRemovePath = $false
      Write-Output "Leaving non-standalone OpenCove launcher at $LauncherPath"
    }
  }

  if (Test-Path -LiteralPath $InstallRoot) {
    Get-ChildItem -LiteralPath $InstallRoot -Filter 'opencove-server-*' -Force |
      Remove-Item -Recurse -Force
    $currentPath = Join-Path $InstallRoot 'current'
    if (Test-Path -LiteralPath $currentPath) {
      Remove-Item -LiteralPath $currentPath -Recurse -Force
    }
  }

  if ($shouldRemovePath) {
    Set-OpenCoveUserPath $BinDir 'remove'
  }
  Write-Output "Removed OpenCove standalone runtime bundles from $InstallRoot"
}

function Get-OpenCoveArch {
  $rawArch = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
  } else {
    $env:PROCESSOR_ARCHITECTURE
  }
  if ([string]::IsNullOrWhiteSpace($rawArch)) {
    throw 'Unsupported architecture: unknown'
  }
  $arch = $rawArch.ToLowerInvariant()

  if ($arch -eq 'amd64' -or $arch -eq 'x86_64') {
    return 'x64'
  }

  if ($arch -eq 'arm64' -or $arch -eq 'aarch64') {
    return 'arm64'
  }

  throw "Unsupported architecture: $rawArch"
}

function Read-RuntimeManifest([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^([^=]+)=(.*)$') {
      $values[$Matches[1]] = $Matches[2]
    }
  }

  if (!$values.ContainsKey('OPENCOVE_NODE_RELATIVE_PATH') -or
      !$values.ContainsKey('OPENCOVE_CLI_SCRIPT_RELATIVE_PATH')) {
    throw 'Standalone runtime manifest is incomplete.'
  }

  return $values
}

function Join-BundlePath([string]$Root, [string]$RelativePath) {
  return Join-Path $Root ($RelativePath -replace '/', '\')
}

function Assert-OpenCoveArchiveChecksum([string]$Path, [string]$AssetName) {
  $checksumsPath = Join-Path $TempDir 'SHA256SUMS.txt'
  if ($env:OPENCOVE_STANDALONE_CHECKSUMS_FILE) {
    Copy-Item -LiteralPath $env:OPENCOVE_STANDALONE_CHECKSUMS_FILE -Destination $checksumsPath -Force
  } else {
    $request = @{
      Uri = $ChecksumsUrl
      OutFile = $checksumsPath
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) {
      $request.UseBasicParsing = $true
    }
    Invoke-WebRequest @request
  }

  $assetPattern = [Regex]::Escape($AssetName)
  $match = Get-Content -LiteralPath $checksumsPath |
    Select-String -Pattern "^(?<hash>[A-Fa-f0-9]{64})\s+\*?$assetPattern$" |
    Select-Object -First 1
  if ($null -eq $match) {
    throw "[opencove-bootstrap:checksum_failed] Checksum for $AssetName not found in $ChecksumsUrl"
  }

  $expected = $match.Matches[0].Groups['hash'].Value.ToLowerInvariant()
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try {
    $actual = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $stream.Dispose()
    $algorithm.Dispose()
  }
  if ($actual -ne $expected) {
    throw "[opencove-bootstrap:checksum_failed] SHA256 mismatch for $AssetName"
  }
  Write-Output "Verified SHA256 for $AssetName"
  $script:VerifiedArtifactDigest = $actual
}

function Escape-CmdValue([string]$Value) {
  return $Value.Replace('%', '%%')
}

function Write-Launcher([string]$NodeBin, [string]$CliScript) {
  $escapedNodeBin = Escape-CmdValue $NodeBin
  $escapedCliScript = Escape-CmdValue $CliScript
  $launcher = @"
@echo off
rem $CliWrapperMarker
rem OPENCOVE_INSTALL_OWNER=$CliWrapperOwnerStandalone
rem OPENCOVE_WRAPPER_KIND=runtime
rem OPENCOVE_NODE_BIN=$escapedNodeBin
rem OPENCOVE_CLI_SCRIPT=$escapedCliScript

set "NODE_BIN=$escapedNodeBin"
set "CLI_SCRIPT=$escapedCliScript"

if not exist "%NODE_BIN%" (
  echo [opencove] bundled Node runtime not found: %NODE_BIN% 1>&2
  exit /b 1
)

if not exist "%CLI_SCRIPT%" (
  echo [opencove] CLI entry not found: %CLI_SCRIPT% 1>&2
  exit /b 1
)

"%NODE_BIN%" "%CLI_SCRIPT%" %*
exit /b %ERRORLEVEL%
"@
  $temporaryLauncher = "$LauncherPath.new.$([Guid]::NewGuid().ToString('N'))"
  [IO.File]::WriteAllText($temporaryLauncher, $launcher, [Text.Encoding]::ASCII)
  try {
    if ([IO.File]::Exists($LauncherPath)) {
      [IO.File]::Replace($temporaryLauncher, $LauncherPath, $null)
    } else {
      try { [IO.File]::Move($temporaryLauncher, $LauncherPath) }
      catch {
        if (![IO.File]::Exists($LauncherPath)) { throw }
        [IO.File]::Replace($temporaryLauncher, $LauncherPath, $null)
      }
    }
  } finally {
    if ([IO.File]::Exists($temporaryLauncher)) { [IO.File]::Delete($temporaryLauncher) }
  }
}

if ($Uninstall) {
  Remove-OpenCoveStandalone
  exit 0
}

if ((Test-Path -LiteralPath $LauncherPath -PathType Leaf) -and !(Test-OwnedLauncher $LauncherPath)) {
  throw "Refusing to overwrite existing non-OpenCove launcher at $LauncherPath"
}

$Arch = Get-OpenCoveArch
$AssetName = "opencove-server-windows-$Arch.zip"
$AssetUrl = "$ReleaseBaseUrl/$AssetName"
$BundleName = [IO.Path]::GetFileNameWithoutExtension($AssetName)
$BundleDir = Join-Path $InstallRoot $BundleName
$RuntimeEnvPath = Join-Path $BundleDir 'opencove-runtime.env'
$TempDir = Join-Path $InstallRoot ".opencove-install-$([Guid]::NewGuid().ToString('N'))"
$ArchivePath = Join-Path $TempDir $AssetName

New-Item -ItemType Directory -Force -Path $InstallRoot, $BinDir, $TempDir | Out-Null

try {
  if ($env:OPENCOVE_STANDALONE_ASSET) {
    Write-Output "Using local standalone asset $env:OPENCOVE_STANDALONE_ASSET"
    Copy-Item -LiteralPath $env:OPENCOVE_STANDALONE_ASSET -Destination $ArchivePath -Force
    Assert-OpenCoveArchiveChecksum $ArchivePath $AssetName
  } else {
    Write-Output "Downloading $AssetUrl"
    $request = @{
      Uri = $AssetUrl
      OutFile = $ArchivePath
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) {
      $request.UseBasicParsing = $true
    }
    Invoke-WebRequest @request
    Assert-OpenCoveArchiveChecksum $ArchivePath $AssetName
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    foreach ($entry in $archive.Entries) {
      $entryPath = $entry.FullName.Replace('\', '/')
      if ($entryPath.StartsWith('/') -or $entryPath.Contains(':') -or
          $entryPath.Split('/').Contains('..') -or
          ($entryPath -ne $BundleName -and !$entryPath.StartsWith("$BundleName/"))) {
        throw '[opencove-bootstrap:runtime_corrupt] Unsafe standalone archive paths.'
      }
    }
  } finally { $archive.Dispose() }
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $TempDir
  $BundleDir = Join-Path $TempDir $BundleName
  $RuntimeEnvPath = Join-Path $BundleDir 'opencove-runtime.env'

  if (!(Test-Path -LiteralPath $RuntimeEnvPath -PathType Leaf)) {
    throw "Standalone runtime manifest not found: $RuntimeEnvPath"
  }

  $nodeBin = Join-Path $BundleDir 'runtime\node\node.exe'
  $publishScript = Join-Path $BundleDir 'app\src\app\cli\publishRuntime.mjs'
  $destination = Join-Path $InstallRoot "$BundleName-$VerifiedArtifactDigest"
  $published = & $nodeBin $publishScript $BundleDir $destination $VerifiedArtifactDigest
  if ($LASTEXITCODE -ne 0) { throw 'Runtime publication failed.' }
  $BundleDir = [string]$published
  $nodeBin = Join-Path $BundleDir 'runtime\node\node.exe'
  $cliScript = Join-Path $BundleDir 'app\src\app\cli\opencove.mjs'

  Write-Launcher $nodeBin $cliScript
  if ($env:OPENCOVE_MANAGED_INSTALL -ne '1') { Set-OpenCoveUserPath $BinDir 'add' }

  Write-Output "Installed OpenCove CLI at $LauncherPath"
  Write-Output "Runtime bundle: $BundleDir"
  Write-Output 'Smoke check:'
  Write-Output '  opencove worker start --help'
} finally {
  if (Test-Path -LiteralPath $TempDir) {
    $canonicalRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
    if (![IO.Path]::GetFullPath($TempDir).StartsWith($canonicalRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Installer cleanup target escaped its installation root.'
    }
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}
