import type { AgentProviderId } from '../../../../shared/contracts/dto'

const SESSION_STATE_WATCHER_RETRY_BASE_DELAY_MS = 250
const SESSION_STATE_WATCHER_RETRY_MAX_DELAY_MS = 15_000

export function resolveSessionStateWatcherRetryDelay(attempt: number): number {
  if (attempt <= 0) {
    return SESSION_STATE_WATCHER_RETRY_BASE_DELAY_MS
  }

  const delay = SESSION_STATE_WATCHER_RETRY_BASE_DELAY_MS * 2 ** attempt
  return Math.min(delay, SESSION_STATE_WATCHER_RETRY_MAX_DELAY_MS)
}

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
