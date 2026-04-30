$ErrorActionPreference = 'Stop'

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

function Remove-OpenCoveUserPath([string]$TargetPath) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $segments = Split-PathValue $current
  $normalizedTarget = Normalize-PathSegment $TargetPath
  $nextSegments = @()

  foreach ($segment in $segments) {
    if ((Normalize-PathSegment $segment) -ne $normalizedTarget) {
      $nextSegments += $segment
    }
  }

  [Environment]::SetEnvironmentVariable('Path', ($nextSegments -join ';'), 'User')
}

if (Test-Path -LiteralPath $LauncherPath -PathType Leaf) {
  $content = Get-Content -LiteralPath $LauncherPath -Raw
  if (!$content.Contains($CliWrapperMarker)) {
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

Remove-OpenCoveUserPath $BinDir
Write-Output "Removed OpenCove standalone runtime bundles from $InstallRoot"
