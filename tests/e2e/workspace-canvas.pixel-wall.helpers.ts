import { expect, type Page, type TestInfo } from '@playwright/test'

async function readWallAnimationDiagnostics(page: Page) {
  return await page.evaluate(async () => {
    const snapshot = () => {
      const wall = document.querySelector('[data-testid="workspace-pixel-wall"]')
      const api = window.__opencovePixelWallTestApi
      return {
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        totalFrames: api?.getFrameCount() ?? null,
        animatedFrames: api?.getAnimatedFrameCount() ?? null,
        renderer: wall?.getAttribute('data-cove-wall-renderer') ?? null,
        state: wall?.getAttribute('data-cove-wall-state') ?? null,
      }
    }
    const before = snapshot()
    const startedAt = performance.now()
    let rafCallbacks = 0
    let frame: number
    const count = () => {
      rafCallbacks++
      frame = window.requestAnimationFrame(count)
    }
    frame = window.requestAnimationFrame(count)
    try {
      // A timer ends the observation even when the browser delivers no display frames.
      await new Promise<void>(resolve => window.setTimeout(resolve, 500))
      return {
        ...snapshot(),
        before,
        rafCallbacks,
        rafSampleMs: 500,
        elapsedMs: performance.now() - startedAt,
      }
    } finally {
      window.cancelAnimationFrame(frame)
    }
  })
}

/** Proves ambient motion makes progress without assuming the browser delivers a fixed rate. */
export async function expectAnimatedWall(page: Page, testInfo: Pick<TestInfo, 'attach'>) {
  const readAnimated = () =>
    page.evaluate(() => window.__opencovePixelWallTestApi?.getAnimatedFrameCount() ?? 0)
  const baseline = await readAnimated()
  try {
    await expect
      .poll(readAnimated, {
        timeout: 3000,
        message: `The pixel wall should paint at least 3 new animated frames (baseline: ${baseline})`,
      })
      .toBeGreaterThanOrEqual(baseline + 3)
  } catch (error) {
    const diagnostics = await readWallAnimationDiagnostics(page).catch(diagnosticError => ({
      diagnosticsError: String(diagnosticError),
    }))
    await testInfo.attach('pixel-wall-animation-diagnostics', {
      body: JSON.stringify({ baseline, ...diagnostics }, null, 2),
      contentType: 'application/json',
    })
    throw error
  }
}

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
