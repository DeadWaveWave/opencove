export function revealHydratedTerminal(
  syncTerminalSize: () => void,
  markHydrated: () => void,
): void {
  requestAnimationFrame(() => {
    syncTerminalSize()
    requestAnimationFrame(markHydrated)
  })
}
