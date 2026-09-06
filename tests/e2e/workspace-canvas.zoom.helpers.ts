import { expect, type Page } from '@playwright/test'
import { readCanvasViewport } from './workspace-canvas.helpers'

export async function wheelToZoom(window: Page, target: number) {
  const bounds = await window.locator('.workspace-canvas').evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  // A real wheel over the empty outer rail follows the application's normal viewport owner.
  await window.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height - 24)
  const current = await readCanvasViewport(window)
  await window.mouse.wheel(0, -Math.log2(target / current.zoom) / 0.002)
  await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeCloseTo(target, 2)
  await window.waitForTimeout(350)
}
