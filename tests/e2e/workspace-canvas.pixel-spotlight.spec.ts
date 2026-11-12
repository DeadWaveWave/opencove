import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { changePixelAppearance, setPixelEffect } from './workspace-canvas.pixel-effects.helpers'
import { expectPaintedWall, readWallProbe } from './workspace-canvas.pixel-wall.helpers'

type FixedFrameWindow = Window & {
  __restoreWallClock?: () => void
  __fixedWallFrame?: { frames: number; signature: number }
}

type Point = { x: number; y: number }

/**
 * Two far-apart points where the pointer is over bare canvas, measured in this window. Ubuntu CI
 * clamps a scale-2 window to its 1600×1200 xvfb screen (800×600 CSS px), so fixed coordinates
 * that suit a 1440×900 window can fall outside it and never light the wall.
 */
async function openWallPoints(page: Page): Promise<[Point, Point]> {
  const points = await page.evaluate(() => {
    const canvas = document.querySelector('.workspace-canvas .react-flow')!.getBoundingClientRect()
    const open: { x: number; y: number }[] = []
    for (let row = 1; row < 8; row++) {
      for (let column = 1; column < 8; column++) {
        const x = Math.round(canvas.left + (canvas.width * column) / 8)
        const y = Math.round(canvas.top + (canvas.height * row) / 8)
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) {
          open.push({ x, y })
        }
      }
    }
    return open
  })
  expect(points.length).toBeGreaterThanOrEqual(2)
  const [first] = points as [Point]
  const far = points.reduce((best, point) =>
    Math.hypot(point.x - first.x, point.y - first.y) >
    Math.hypot(best.x - first.x, best.y - first.y)
      ? point
      : best,
  )
  return [first, far]
}

async function pointFrame(page: Page, { x, y }: Point) {
  await page.mouse.move(x, y)
  // Repaint at a fixed ambient time, so the signature isolates the pointer, not drifting clouds.
  const before = await page.evaluate(() => {
    const frames = window.__opencovePixelWallTestApi!.getFrameCount()
    window.dispatchEvent(new Event('opencove-theme-changed'))
    return frames
  })
  // A native callback queued before installing the clock may still paint once. Only accept
  // retained evidence from a callback that actually drew the wall at the controlled time.
  await expect
    .poll(() => page.evaluate(() => (window as FixedFrameWindow).__fixedWallFrame?.frames ?? 0))
    .toBeGreaterThan(before)
  return page.evaluate(() => (window as FixedFrameWindow).__fixedWallFrame!.signature)
}

test('lights the pointer over finished wall tiles and disables it with ambient motion', async () => {
  const { electronApp, window: page } = await launchApp({ deviceScaleFactor: 2 })
  try {
    const cdp = await page.context().newCDPSession(page)
    const media = async (motion: string, transparency = 'no-preference') => {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: motion },
          { name: 'prefers-reduced-transparency', value: transparency },
        ],
      })
    }
    await media('no-preference')
    await clearAndSeedWorkspace(
      page,
      [
        {
          id: 'spot-note',
          kind: 'note',
          title: 'Light on the wall',
          position: { x: 400, y: 240 },
          width: 320,
          height: 240,
          task: { text: 'The pointer never changes the content.' },
        },
      ],
      {
        settings: {
          uiTheme: 'dark',
          language: 'en',
          canvasBackgroundStyle: 'pixel',
          canvasBackgroundTwinkleEnabled: true,
          nodeCreationPixelEffectEnabled: false,
        },
      },
    )
    await expectPaintedWall(page)
    const [near, away] = await openWallPoints(page)
    await page.evaluate(() => {
      const original = window.requestAnimationFrame.bind(window)
      const fixedTime = performance.now() + 60000
      window.requestAnimationFrame = callback =>
        original(() => {
          const api = window.__opencovePixelWallTestApi!
          const before = api.getFrameCount()
          callback(fixedTime)
          if (api.getFrameCount() > before) {
            ;(window as FixedFrameWindow).__fixedWallFrame = {
              frames: api.getFrameCount(),
              signature: api.getSignature(),
            }
          }
        })
      ;(window as FixedFrameWindow).__restoreWallClock = () => {
        window.requestAnimationFrame = original
      }
    })
    const layoutReads = await page.getByTestId('workspace-pixel-wall').evaluate((host, point) => {
      const read = host.getBoundingClientRect.bind(host)
      let reads = 0
      host.getBoundingClientRect = () => {
        reads++
        return read()
      }
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', { clientX: point.x + i, clientY: point.y }),
        )
      }
      host.getBoundingClientRect = read
      return reads
    }, near)
    expect(layoutReads).toBe(0)
    const first = await pointFrame(page, near)
    expect(await pointFrame(page, near)).toBe(first)
    const moved = await pointFrame(page, away)
    expect(moved).not.toBe(first)
    expect(await pointFrame(page, near)).toBe(first)
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null })),
    )
    const left = await pointFrame(page, { x: -10, y: -10 })
    expect(left).not.toBe(first)

    await media('reduce')
    expect(await pointFrame(page, near)).toBe(await pointFrame(page, away))
    await media('no-preference', 'reduce')
    expect(await pointFrame(page, near)).not.toBe(await pointFrame(page, away))
    await media('no-preference')
    await changePixelAppearance(page, () =>
      setPixelEffect(page, 'canvasBackgroundTwinkleEnabled', false),
    )
    expect(await pointFrame(page, near)).toBe(await pointFrame(page, away))
    // Return to the native clock for scheduler/visibility evidence.
    await page.evaluate(() => (window as FixedFrameWindow).__restoreWallClock?.())
    await changePixelAppearance(page, () =>
      setPixelEffect(page, 'canvasBackgroundTwinkleEnabled', true),
    )
    const budget = await page.evaluate(async () => {
      const api = window.__opencovePixelWallTestApi!
      const frames = api.getFrameCount(),
        at = performance.now(),
        focused = document.hasFocus()
      await new Promise(resolve => setTimeout(resolve, 600))
      return { frames: api.getFrameCount() - frames, elapsed: performance.now() - at, focused }
    })
    expect(budget.frames).toBeLessThanOrEqual(
      Math.ceil((budget.elapsed / 1000) * (budget.focused ? 30 : 10)) + 2,
    )
    const nativeWindow = await electronApp.browserWindow(page)
    await nativeWindow.evaluate(window => window.hide())
    expect(await nativeWindow.evaluate(window => window.isVisible())).toBe(false)
    await page.evaluate(() => {
      // The harness disables background throttling and Playwright emulates an active page.
      // Feed the real wall listener its production hidden input, independently of those overrides.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const hidden = (await readWallProbe(page))!.frames
    await page.waitForTimeout(300)
    expect((await readWallProbe(page))!.frames).toBe(hidden)
  } finally {
    await page
      .evaluate(() => {
        Reflect.deleteProperty(document, 'visibilityState')
        ;(window as FixedFrameWindow).__restoreWallClock?.()
      })
      .catch(() => undefined)
    await electronApp.close()
  }
})
