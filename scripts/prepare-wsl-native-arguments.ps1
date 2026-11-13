$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'WSL guest provisioning is restricted to GitHub-hosted Windows CI.'
}

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  'WSL guest provisioning skipped: wsl.exe is unavailable. The native suite will report its guest skip reason.' >> $env:GITHUB_STEP_SUMMARY
  exit 0
}
$feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
if ($feature.State -ne 'Enabled') {
  'WSL 1 guest provisioning skipped: the optional feature is disabled. The native suite will probe installed guests.' >> $env:GITHUB_STEP_SUMMARY
  exit 0
}

$distribution = "OpenCoveNativeArgv-${env:GITHUB_RUN_ID}-${env:GITHUB_RUN_ATTEMPT}"
$directory = Join-Path $env:RUNNER_TEMP 'opencove-native-arguments-wsl'
$rootfs = Join-Path $directory 'ubuntu.rootfs.tar.gz'
New-Item -ItemType Directory -Path $directory | Out-Null
# Canonical Ubuntu 24.04 WSL image; SHA256SUMS and manifest are published alongside it.
# The image already contains /usr/bin/python3; no guest package installation is needed.
$uri = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz'
Invoke-WebRequest -Uri $uri -OutFile $rootfs
$expected = '2a790896740b14d637dbdc583cce1ba081ac53b9e9cdb46dc09a2f73abbd9934'
if ((Get-FileHash -Algorithm SHA256 $rootfs).Hash.ToLowerInvariant() -ne $expected) {
  throw 'The Ubuntu WSL receiver image does not match its pinned checksum.'
}

# WSL 1 exercises the same wsl.exe scanner without requiring nested virtualization.
& wsl.exe --import $distribution (Join-Path $directory 'guest') $rootfs --version 1
if ($LASTEXITCODE -ne 0) { throw "WSL guest import failed: $LASTEXITCODE" }
"OPENCOVE_CI_WSL_DISTRO=$distribution" >> $env:GITHUB_ENV
& wsl.exe --distribution $distribution --exec /usr/bin/python3 --version
if ($LASTEXITCODE -ne 0) { throw "WSL Python receiver is unavailable: $LASTEXITCODE" }
"OPENCOVE_TEST_WSL_DISTRO=$distribution" >> $env:GITHUB_ENV
"WSL native argument receiver configured: $distribution (WSL 1, Python 3)." >> $env:GITHUB_STEP_SUMMARY
