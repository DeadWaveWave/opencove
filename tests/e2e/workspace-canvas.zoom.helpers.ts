import { expect, type Page } from '@playwright/test'
import { readCanvasViewport } from './workspace-canvas.helpers'

export async function hoverCanvasPane(window: Page) {
  const paneLocator = window.locator('.workspace-canvas .react-flow__pane')
  const pointHandle = await window.waitForFunction(
    () => {
      const pane = document.querySelector('.workspace-canvas .react-flow__pane')
      if (!pane) {
        return null
      }
      const rect = pane.getBoundingClientRect()
      const left = Math.max(rect.left, 0)
      const top = Math.max(rect.top, 0)
      const right = Math.min(rect.right, window.innerWidth)
      const bottom = Math.min(rect.bottom, window.innerHeight)

      // The outer rail can contain an editor or overlay at smaller window sizes.
      // Only a direct pane hit guarantees that the canvas owns this wheel.
      for (let y = bottom - 24; y >= top + 8; y -= 32) {
        for (let x = right - 8; x >= left + 8; x -= 32) {
          if (document.elementFromPoint(x, y) === pane) {
            return { x: x - rect.left, y: y - rect.top }
          }
        }
      }
      return null
    },
    undefined,
    { timeout: 15_000 },
  )
  const point = await pointHandle.jsonValue()
  await pointHandle.dispose()
  if (!point) {
    throw new Error('No unobstructed canvas point is available for wheel zoom')
  }
  // Hover also waits for the pane's geometry to be stable before sending input.
  await paneLocator.hover({ position: point })
  return point
}

export async function wheelToZoom(window: Page, target: number) {
  await hoverCanvasPane(window)
  const current = await readCanvasViewport(window)
  await window.mouse.wheel(0, -Math.log2(target / current.zoom) / 0.002)
  await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeCloseTo(target, 2)
  await window.waitForTimeout(350)
}
