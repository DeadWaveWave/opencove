$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'WSL guest cleanup is restricted to GitHub-hosted CI.'
}
$expected = "OpenCoveNativeArgv-${env:GITHUB_RUN_ID}-${env:GITHUB_RUN_ATTEMPT}"
if ($env:OPENCOVE_CI_WSL_DISTRO -eq $expected) {
  & wsl.exe --unregister $expected
  if ($LASTEXITCODE -ne 0) { throw "WSL guest cleanup failed: $LASTEXITCODE" }
}
$directory = Join-Path $env:RUNNER_TEMP 'opencove-native-arguments-wsl'
if (Test-Path $directory) { Remove-Item -Recurse -Force $directory }
