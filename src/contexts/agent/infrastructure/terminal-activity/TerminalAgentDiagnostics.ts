export type TerminalAgentDiagnostic =
  | { type: 'assets-repaired'; count: number }
  | { type: 'prepare-fallback'; stage: 'assets' | 'reservation' | 'environment'; reason: string }

export type TerminalAgentDiagnosticSink = (event: TerminalAgentDiagnostic) => void

export function terminalAgentFailureReason(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  // Never emit arbitrary messages, file paths, commands, environment, or credentials.
  return typeof code === 'string' &&
    ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EBUSY', 'UNSAFE_ASSET'].includes(code)
    ? code
    : 'unavailable'
}

export function emitTerminalAgentDiagnostic(
  sink: TerminalAgentDiagnosticSink | undefined,
  event: TerminalAgentDiagnostic,
): void {
  try {
    sink?.(event)
  } catch {
    // Optional diagnostics must not acquire launch authority.
  }
}
