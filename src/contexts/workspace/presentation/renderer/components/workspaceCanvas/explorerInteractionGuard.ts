let suppressedUntil = 0

export function suppressExplorerOverlayInteractions(durationMs = 320): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  suppressedUntil = now + Math.max(0, durationMs)
}

export function isExplorerOverlayInteractionSuppressed(): boolean {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return now < suppressedUntil
}
