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

function Remove-OpenCoveStandalone {
  if (Test-Path -LiteralPath $LauncherPath -PathType Leaf) {
    if (!(Test-OwnedLauncher $LauncherPath)) {
      throw "Refusing to remove existing non-OpenCove launcher at $LauncherPath"
    }

    Remove-Item -LiteralPath $LauncherPath -Force
    Write-Output "Removed OpenCove CLI launcher at $LauncherPath"
  }

  if (Test-Path -LiteralPath $InstallRoot) {
    Get-ChildItem -LiteralPath $InstallRoot -Filter 'opencove-server-*' -Force |
      Remove-Item -Recurse -Force
    $currentPath = Join-Path $InstallRoot 'current'
    if (Test-Path -LiteralPath $currentPath) {
      Remove-Item -LiteralPath $currentPath -Recurse -Force
    }
  }

  Set-OpenCoveUserPath $BinDir 'remove'
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

  if (!$values.ContainsKey('OPENCOVE_EXECUTABLE_RELATIVE_PATH') -or
      !$values.ContainsKey('OPENCOVE_CLI_SCRIPT_RELATIVE_PATH')) {
    throw 'Standalone runtime manifest is incomplete.'
  }

  return $values
}

function Join-BundlePath([string]$Root, [string]$RelativePath) {
  return Join-Path $Root ($RelativePath -replace '/', '\')
}

function Escape-CmdValue([string]$Value) {
  return $Value.Replace('%', '%%')
}

function Write-Launcher([string]$ElectronBin, [string]$CliScript) {
  $escapedElectronBin = Escape-CmdValue $ElectronBin
  $escapedCliScript = Escape-CmdValue $CliScript
  $launcher = @"
@echo off
rem $CliWrapperMarker
rem OPENCOVE_WRAPPER_KIND=runtime
rem OPENCOVE_ELECTRON_BIN=$escapedElectronBin
rem OPENCOVE_CLI_SCRIPT=$escapedCliScript

set "ELECTRON_BIN=$escapedElectronBin"
set "CLI_SCRIPT=$escapedCliScript"

if not exist "%ELECTRON_BIN%" (
  echo [opencove] OpenCove executable not found: %ELECTRON_BIN% 1>&2
  exit /b 1
)

echo "%CLI_SCRIPT%" | findstr /i /c:".asar\" /c:".asar/" >nul
if errorlevel 1 (
  if not exist "%CLI_SCRIPT%" (
    echo [opencove] CLI entry not found: %CLI_SCRIPT% 1>&2
    exit /b 1
  )
)

set "ELECTRON_RUN_AS_NODE=1"
"%ELECTRON_BIN%" "%CLI_SCRIPT%" %*
exit /b %ERRORLEVEL%
"@
  Set-Content -LiteralPath $LauncherPath -Value $launcher -Encoding ASCII
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
$TempDir = Join-Path ([IO.Path]::GetTempPath()) "opencove-install-$([Guid]::NewGuid().ToString('N'))"
$ArchivePath = Join-Path $TempDir $AssetName

New-Item -ItemType Directory -Force -Path $InstallRoot, $BinDir, $TempDir | Out-Null

try {
  if ($env:OPENCOVE_STANDALONE_ASSET) {
    Write-Output "Using local standalone asset $env:OPENCOVE_STANDALONE_ASSET"
    Copy-Item -LiteralPath $env:OPENCOVE_STANDALONE_ASSET -Destination $ArchivePath -Force
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
  }

  if (Test-Path -LiteralPath $BundleDir) {
    Remove-Item -LiteralPath $BundleDir -Recurse -Force
  }

  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $InstallRoot -Force

  if (!(Test-Path -LiteralPath $RuntimeEnvPath -PathType Leaf)) {
    throw "Standalone runtime manifest not found: $RuntimeEnvPath"
  }

  $manifest = Read-RuntimeManifest $RuntimeEnvPath
  $electronBin = Join-BundlePath $BundleDir $manifest['OPENCOVE_EXECUTABLE_RELATIVE_PATH']
  $cliScript = Join-BundlePath $BundleDir $manifest['OPENCOVE_CLI_SCRIPT_RELATIVE_PATH']

  Write-Launcher $electronBin $cliScript
  Set-OpenCoveUserPath $BinDir 'add'

  Write-Output "Installed OpenCove CLI at $LauncherPath"
  Write-Output "Runtime bundle: $BundleDir"
  Write-Output 'Smoke check:'
  Write-Output '  opencove worker start --help'
} finally {
  if (Test-Path -LiteralPath $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}
