import { expect, test, type Page } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { expectPaintedWall } from './workspace-canvas.pixel-wall.helpers'

const TERMINAL_ID = 'ripple-terminal'

async function seed(window: Page, canvasBackgroundStyle: 'pixel' | 'minimal') {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: TERMINAL_ID,
        title: 'Ripple terminal',
        position: { x: 200, y: 160 },
        width: 560,
        height: 340,
      },
    ],
    {
      settings: {
        uiTheme: 'dark',
        language: 'en',
        ...PIXEL_EFFECTS_ENABLED,
        canvasBackgroundStyle,
      },
    },
  )
}

/** Prints a marker the typed command cannot contain, so the output really came from the shell. */
async function printOutput(window: Page) {
  const suffix = Date.now().toString(36)
  const command =
    process.platform === 'win32'
      ? buildNodeEvalCommand(`process.stdout.write(${JSON.stringify(`RIPPLE_${suffix}\n`)})`)
      : `printf '%s_%s\\n' 'RIPPLE' '${suffix}'`
  const terminal = window.locator(`.react-flow__node[data-id="${TERMINAL_ID}"]`)
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await window.keyboard.type(command)
  await window.keyboard.press('Enter')
  await expect(terminal).toContainText(`RIPPLE_${suffix}`)
}

const rippleCount = (window: Page) =>
  window.evaluate(() => window.__opencovePixelWallTestApi?.getRippleCount() ?? 0)
// A ripple lasts about a second; a slow runner can miss it between polls, so read what was seen.
const seenRipples = (window: Page) =>
  window.evaluate(() => window.__opencovePixelWallTestApi?.getSeenRippleKeys() ?? [])

type DotWindow = Window & { __coveDotRipplePixels?: number }

test.describe('Workspace Canvas - Output ripples', () => {
  test('sends a ripple across the pixel wall when a window receives output', async ({
    browserName,
  }) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      await seed(window, 'pixel')
      await expectPaintedWall(window)
      await printOutput(window)
      await expect.poll(() => seenRipples(window)).toContain(TERMINAL_ID)
      // A ripple lasts about a second and is then forgotten.
      await expect.poll(() => rippleCount(window), { timeout: 5_000 }).toBe(0)
    } finally {
      await electronApp.close()
    }
  })

  test('shows no ripples with reduced motion', async ({ browserName }) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await window.emulateMedia({ reducedMotion: 'reduce' })
      await seed(window, 'pixel')
      await expectPaintedWall(window)
      await printOutput(window)
      await window.waitForTimeout(300)
      expect(await rippleCount(window)).toBe(0)
      expect(await seenRipples(window)).toEqual([])
    } finally {
      await electronApp.close()
    }
  })

  test('ripples through the dot grid on the minimal background', async ({ browserName }) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      await seed(window, 'minimal')
      await expect(window.getByTestId('workspace-pixel-wall')).toHaveCount(0)
      const layer = window.getByTestId('workspace-pixel-layer')
      await expect(layer).toHaveCount(1)
      // Sample the canvas after every frame's draw while the layer reports a ripple, so a slow
      // runner cannot miss the one-second wave between polls.
      await layer.evaluate(element => {
        const canvas = element as HTMLCanvasElement
        const target = window as DotWindow
        target.__coveDotRipplePixels = 0
        const sample = () => {
          if (Number(canvas.dataset.covePixelRipples ?? 0) > 0 && canvas.width > 0) {
            const data = canvas
              .getContext('2d')!
              .getImageData(0, 0, canvas.width, canvas.height).data
            let painted = 0
            for (let index = 3; index < data.length; index += 16) {
              if (data[index]! > 0) {
                painted++
              }
            }
            target.__coveDotRipplePixels = Math.max(target.__coveDotRipplePixels ?? 0, painted)
          }
          requestAnimationFrame(() => setTimeout(sample, 0))
        }
        requestAnimationFrame(() => setTimeout(sample, 0))
      })
      await printOutput(window)
      await expect
        .poll(() => window.evaluate(() => (window as DotWindow).__coveDotRipplePixels ?? 0))
        .toBeGreaterThan(20)
    } finally {
      await electronApp.close()
    }
  })
})
