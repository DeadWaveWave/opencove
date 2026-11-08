import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import {
  expectAnimatedWall,
  expectPaintedWall,
  readWallProbe,
} from './workspace-canvas.pixel-wall.helpers'

async function seed(window: Page, settings: Record<string, unknown> = {}) {
  await window.emulateMedia({ reducedMotion: 'no-preference' })
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: 'showcase-note',
        title: 'Showcase',
        kind: 'note',
        position: { x: 260, y: 200 },
        width: 320,
        height: 220,
        task: { text: 'Recording the canvas.' },
      },
    ],
    {
      settings: {
        uiTheme: 'dark',
        ...PIXEL_EFFECTS_ENABLED,
        language: 'en',
        isPrimarySidebarCollapsed: false,
        // Twinkle off: only showcase mode keeps the wall moving.
        canvasBackgroundTwinkleEnabled: false,
        ...settings,
      },
    },
  )
}

async function readLayout(window: Page) {
  return await window.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)?.getBoundingClientRect()
      return bounds ? [bounds.x, bounds.y, bounds.width, bounds.height].map(Math.round) : null
    }
    return {
      shell: rect('.app-shell'),
      main: rect('.workspace-main'),
      header: rect('.app-header'),
      sidebar: rect('.workspace-sidebar'),
    }
  })
}

async function animatedFramesAfter(window: Page, ms: number) {
  const before = (await readWallProbe(window))?.animated ?? 0
  await window.waitForTimeout(ms)
  return ((await readWallProbe(window))?.animated ?? 0) - before
}

async function runCommand(window: Page, query: string, id: string) {
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P')
  await window.getByTestId('command-center-input').fill(query)
  await window.getByTestId(`command-center-item-${id}`).click()
}

test.describe('Workspace Canvas - Showcase mode', () => {
  test('hides the interface frame, keeps the wall moving and restores everything on Esc', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seed(window)
      await expectPaintedWall(window)
      const before = await readLayout(window)
      expect(await animatedFramesAfter(window, 400)).toBe(0)

      await runCommand(window, 'showcase', 'command:showcase-mode')
      await expect(window.locator('html')).toHaveAttribute('data-cove-showcase', '')
      await expect(window.getByTestId('showcase-hint')).toBeVisible()
      await expect(window.locator('.app-header')).toBeHidden()
      await expect(window.locator('.workspace-sidebar')).toBeHidden()
      await expect(window.locator('.workspace-canvas__controls')).toBeHidden()
      // The canvas is the whole window, and the wall drifts even with twinkle off.
      await expect.poll(async () => (await readLayout(window)).main).toEqual(before.shell)
      await expectAnimatedWall(window, testInfo)
      await expect(window.getByTestId('showcase-hint')).toHaveCount(0, { timeout: 5_000 })
      await testInfo.attach('showcase', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      await window.keyboard.press('Escape')
      await expect(window.locator('html')).not.toHaveAttribute('data-cove-showcase', '')
      await expect.poll(() => readLayout(window)).toEqual(before)
      expect(await animatedFramesAfter(window, 400)).toBe(0)
    } finally {
      await electronApp.close()
    }
  })

  test('comes from the command center, shows the pixel wall over any background and ends with the session', async ({
    browserName,
  }) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seed(window, { canvasBackgroundStyle: 'minimal' })
      await expect(window.getByTestId('workspace-pixel-wall')).toHaveCount(0)

      await runCommand(window, 'showcase', 'command:showcase-mode')
      await expect(window.locator('html')).toHaveAttribute('data-cove-showcase', '')
      await expectPaintedWall(window)

      // Leaving restores the saved background.
      await runCommand(window, 'showcase', 'command:showcase-mode')
      await expect(window.locator('html')).not.toHaveAttribute('data-cove-showcase', '')
      await expect(window.getByTestId('workspace-pixel-wall')).toHaveCount(0)

      // Nothing is saved: a reload starts without it.
      await runCommand(window, 'showcase', 'command:showcase-mode')
      await expect(window.locator('html')).toHaveAttribute('data-cove-showcase', '')
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.app-header')).toBeVisible()
      await expect(window.locator('html')).not.toHaveAttribute('data-cove-showcase', '')
    } finally {
      await electronApp.close()
    }
  })
})
