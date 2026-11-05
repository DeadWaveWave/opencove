import { expect, type Page } from '@playwright/test'

export async function readWallProbe(page: Page) {
  return await page.evaluate(() => {
    const api = window.__opencovePixelWallTestApi
    return api
      ? {
          frames: api.getFrameCount(),
          animated: api.getAnimatedFrameCount(),
          signature: api.getSignature(),
          mean: api.getMeanColor(),
        }
      : null
  })
}

/** The wall is mounted, has a renderer and has painted at least one frame. */
export async function expectPaintedWall(page: Page) {
  const wall = page.getByTestId('workspace-pixel-wall')
  await expect(wall).toBeVisible()
  await expect(wall).toHaveAttribute('data-cove-wall-state', 'ready')
  await expect(wall).toHaveAttribute('data-cove-wall-renderer', /^(webgl|2d)$/)
  await expect.poll(async () => (await readWallProbe(page))?.frames ?? 0).toBeGreaterThan(0)
}

/** A still wall paints no frame with a clock and keeps the same cells. */
export async function expectStillWall(page: Page, ms = 500) {
  await expectPaintedWall(page)
  const before = await readWallProbe(page)
  await page.waitForTimeout(ms)
  const after = await readWallProbe(page)
  expect(after?.animated).toBe(before?.animated)
  expect(after?.signature).toBe(before?.signature)
}
