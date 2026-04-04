import type { AgentProviderId } from '../../../../shared/contracts/dto'

function isSessionStateWatcherDiagnosticsEnabled(): boolean {
  return process.env['OPENCOVE_TERMINAL_DIAGNOSTICS'] === '1'
}

export function logSessionStateWatcherDiagnostics(
  event: string,
  details: Record<string, unknown>,
): void {
  if (!isSessionStateWatcherDiagnosticsEnabled()) {
    return
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    source: 'main-session-state-watcher',
    event,
    details,
  })
  process.stdout.write(`[opencove-terminal-diagnostics] ${line}\n`)
}

export function isJsonlProvider(provider: AgentProviderId): boolean {
  return provider === 'claude-code' || provider === 'codex'
}
