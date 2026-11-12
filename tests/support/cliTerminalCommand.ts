/** Capture the preceding command status before printing the frame delimiter. */
export function terminalExitStatus(platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? 'Write-Output ("`nexit=" + $LASTEXITCODE)'
    : 'printf \'\\nexit=%s\\n\' "$?"'
}
