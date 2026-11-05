import type { Locator } from '@playwright/test'

/**
 * A pane-relative point where the canvas pane itself is hit: not a window, a Space, the HUD or
 * any other overlay. Scans from the top left, so it stays near the corner tests used to assume.
 */
export async function findEmptyPanePoint(pane: Locator): Promise<{ x: number; y: number }> {
  const point = await pane.evaluate(element => {
    const rect = element.getBoundingClientRect()
    for (let y = 16; y < rect.height - 16; y += 24) {
      for (let x = 16; x < rect.width - 16; x += 24) {
        if (document.elementFromPoint(rect.left + x, rect.top + y) === element) {
          return { x, y }
        }
      }
    }
    return null
  })
  if (!point) {
    throw new Error('No empty canvas point is available')
  }
  return point
}

/**
 * Where a marquee can start near the canvas's top left corner: 40px in, moved down past the
 * HUD's far / near switch when it covers that spot. Client coordinates.
 */
export async function findMarqueeCorner(pane: Locator): Promise<{ x: number; y: number }> {
  return await pane.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const x = rect.left + 40
    for (let y = rect.top + 40; y < rect.bottom - 16; y += 4) {
      if (!document.elementFromPoint(x, y)?.closest('.workspace-canvas-hud')) {
        return { x, y }
      }
    }
    return { x, y: rect.top + 40 }
  })
}
