import { screen } from 'electron'
import type { BrowserWindow } from 'electron'

export function resolveBrowserWindowScaleFactor(window: BrowserWindow | null): number {
  if (!window || window.isDestroyed()) {
    return 1
  }

  try {
    const display = screen.getDisplayMatching(window.getBounds())
    const scaleFactor = display?.scaleFactor
    if (typeof scaleFactor !== 'number' || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return 1
    }

    return scaleFactor
  } catch {
    return 1
  }
}
