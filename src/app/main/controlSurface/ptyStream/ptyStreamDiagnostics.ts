export function logPtyStreamResizeDiagnostics(payload: Record<string, unknown>): void {
  if (process.env.OPENCOVE_TERMINAL_DIAGNOSTICS !== '1') {
    return
  }

  process.stderr.write(
    `[opencove-pty-resize] ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`,
  )
}
