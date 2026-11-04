import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { expectPaintedWall, readWallProbe } from './workspace-canvas.pixel-wall.helpers'
import { wheelToZoom } from './workspace-canvas.zoom.helpers'

type LoseContextWindow = Window & { __wallLoseContext?: WEBGL_lose_context | null }

async function seed(window: Page) {
  await window.emulateMedia({ reducedMotion: 'no-preference' })
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: 'wall-note',
        title: 'Wall context',
        kind: 'note',
        position: { x: 260, y: 200 },
        width: 320,
        height: 220,
        task: { text: 'The wall sits under every window.' },
      },
    ],
    { settings: { uiTheme: 'dark', ...PIXEL_EFFECTS_ENABLED, language: 'en' } },
  )
}

async function readFallbackPixels(window: Page) {
  return await window.locator('.workspace-pixel-wall__surface--2d').evaluate(element => {
    const canvas = element as HTMLCanvasElement
    if (canvas.width === 0 || canvas.height === 0) {
      return 0
    }
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let index = 0; index < data.length; index += 16) {
      if (data[index]! + data[index + 1]! + data[index + 2]! > 0) {
        painted++
      }
    }
    return painted
  })
}

async function animatedFramesAfter(window: Page, ms: number) {
  const before = (await readWallProbe(window))?.animated ?? 0
  await window.waitForTimeout(ms)
  return ((await readWallProbe(window))?.animated ?? 0) - before
}

test.describe('Workspace Canvas - Pixel Wall', () => {
  test('paints the wall, shows a still wall while the GPU context is lost and returns after restore', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seed(window)
      await expectPaintedWall(window)
      const wall = window.getByTestId('workspace-pixel-wall')
      const renderer = await wall.getAttribute('data-cove-wall-renderer')
      testInfo.annotations.push({ type: 'pixel-wall-renderer', description: renderer ?? '' })
      // Ambient motion runs on the decorative scheduler.
      expect(await animatedFramesAfter(window, 500)).toBeGreaterThan(3)
      await testInfo.attach('pixel-wall', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      if (renderer !== 'webgl') {
        // Software rendering only: the Canvas 2D wall paints and animates instead.
        await expect(window.locator('.workspace-pixel-wall__surface--2d')).toBeVisible()
        await expect.poll(() => readFallbackPixels(window)).toBeGreaterThan(100)
        return
      }

      await expect(window.locator('.workspace-pixel-wall__surface--2d')).toBeHidden()
      await window.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '.workspace-pixel-wall__surface--gl',
        )
        const extension = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context') ?? null
        ;(window as LoseContextWindow).__wallLoseContext = extension
        extension?.loseContext()
      })
      await expect(wall).toHaveAttribute('data-cove-wall-state', 'lost')
      await expect(wall).toHaveAttribute('data-cove-wall-renderer', '2d')
      await expect(window.locator('.workspace-pixel-wall__surface--2d')).toBeVisible()
      await expect.poll(() => readFallbackPixels(window)).toBeGreaterThan(100)
      expect(await animatedFramesAfter(window, 400)).toBe(0)
      await testInfo.attach('pixel-wall-lost', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      await window.evaluate(() => (window as LoseContextWindow).__wallLoseContext?.restoreContext())
      await expect(wall).toHaveAttribute('data-cove-wall-state', 'ready')
      await expect(wall).toHaveAttribute('data-cove-wall-renderer', 'webgl')
      await expect(window.locator('.workspace-pixel-wall__surface--2d')).toBeHidden()
      expect(await animatedFramesAfter(window, 500)).toBeGreaterThan(3)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps cells between 13 and 26 screen pixels at every zoom', async ({ browserName }) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seed(window)
      await expectPaintedWall(window)
      const wall = window.getByTestId('workspace-pixel-wall')
      const cells = new Set<string>()
      for (const zoom of [0.3, 0.6, 1.4]) {
        // eslint-disable-next-line no-await-in-loop -- Each zoom step is a real wheel gesture.
        await wheelToZoom(window, zoom)
        // eslint-disable-next-line no-await-in-loop -- Sample the wall at the settled zoom.
        const actual = (await readCanvasViewport(window)).zoom
        // eslint-disable-next-line no-await-in-loop -- The wall repaints on the next frame.
        await expect
          .poll(async () => Number(await wall.getAttribute('data-cove-wall-cell')))
          .toBeCloseTo(24 * 2 ** Math.ceil(Math.log2(13 / (24 * actual))) * actual, 1)
        // eslint-disable-next-line no-await-in-loop -- Read the settled value once.
        const cell = Number(await wall.getAttribute('data-cove-wall-cell'))
        expect(cell).toBeGreaterThanOrEqual(13)
        expect(cell).toBeLessThan(26)
        cells.add(cell.toFixed(1))
      }
      expect(cells.size).toBeGreaterThan(1)
    } finally {
      await electronApp.close()
    }
  })
})
