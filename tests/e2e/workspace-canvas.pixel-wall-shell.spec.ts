import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { expectPaintedWall } from './workspace-canvas.pixel-wall.helpers'

/**
 * Pins the system's motion and transparency preferences. macOS CI runners reduce transparency,
 * which rightly makes the shell opaque; one call, as it replaces every emulated media feature.
 */
async function emulateSystem(window: Page, transparency: 'no-preference' | 'reduce') {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'no-preference' },
      { name: 'prefers-reduced-transparency', value: transparency },
    ],
  })
}

async function seed(
  window: Page,
  settings: Record<string, unknown> = {},
  transparency: 'no-preference' | 'reduce' = 'no-preference',
) {
  await emulateSystem(window, transparency)
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
        task: { text: 'The shell floats on the wall.' },
      },
    ],
    {
      settings: {
        uiTheme: 'dark',
        ...PIXEL_EFFECTS_ENABLED,
        language: 'en',
        isPrimarySidebarCollapsed: false,
        ...settings,
      },
    },
  )
}

/** Shell, window and wall geometry, all relative to the app shell, plus the wall's last frame. */
async function readShell(window: Page) {
  return await window.evaluate(() => {
    const shell = document.querySelector('.app-shell')!.getBoundingClientRect()
    const rect = (selector: string) => {
      const element = document.querySelector(selector)
      if (!element) {
        return null
      }
      const bounds = element.getBoundingClientRect()
      return [bounds.left - shell.left, bounds.top - shell.top, bounds.width, bounds.height].map(
        Math.round,
      )
    }
    const alpha = (selector: string) => {
      const context = document.createElement('canvas').getContext('2d')!
      context.fillStyle = getComputedStyle(document.querySelector(selector)!).backgroundColor
      context.fillRect(0, 0, 1, 1)
      return context.getImageData(0, 0, 1, 1).data[3]
    }
    const api = window.__opencovePixelWallTestApi
    return {
      wall: rect('[data-testid="workspace-pixel-wall"]'),
      shell: [0, 0, shell.width, shell.height].map(Math.round),
      header: rect('.app-header'),
      sidebar: rect('.workspace-sidebar'),
      main: rect('.workspace-main'),
      note: rect('.react-flow__node[data-id="wall-note"]'),
      layerChildren: document.querySelector('.app-shell__wall')?.childElementCount ?? -1,
      headerFilter: getComputedStyle(document.querySelector('.app-header')!).backdropFilter,
      sidebarFilter: getComputedStyle(document.querySelector('.workspace-sidebar')!).backdropFilter,
      headerAlpha: alpha('.app-header'),
      sidebarAlpha: alpha('.workspace-sidebar'),
      chrome: api?.getChromeRects().map(r => r.map(Math.round)) ?? [],
      glass: api?.getGlassRects().map(r => r.map(Math.round)) ?? [],
    }
  })
}

function near(actual: number[] | null | undefined, expected: number[] | null | undefined) {
  expect(actual).toBeTruthy()
  expect(expected).toBeTruthy()
  actual!.forEach((value, index) =>
    expect(Math.abs(value - expected![index]!)).toBeLessThanOrEqual(1),
  )
}

test.describe('Workspace Canvas - Pixel wall behind the shell', () => {
  test('fills the window, frosts the top bar and sidebar, and keeps glass on windows as the sidebar moves', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seed(window)
      await expectPaintedWall(window)
      const pinned = await readShell(window)
      // The wall is the whole window; the canvas keeps its place in the layout.
      expect(pinned.wall).toEqual(pinned.shell)
      // The top bar and sidebar are glass on the wall: no backdrop blur, a see-through tint.
      expect(pinned.headerFilter).toBe('none')
      expect(pinned.sidebarFilter).toBe('none')
      expect(pinned.headerAlpha).toBeLessThan(255)
      expect(pinned.sidebarAlpha).toBeLessThan(255)
      // The wall frosts exactly the chrome around the canvas.
      await expect.poll(async () => (await readShell(window)).chrome.length).toBe(2)
      const chrome = (await readShell(window)).chrome
      near(chrome[0], pinned.header)
      near(chrome[1], [0, pinned.header![3]!, pinned.sidebar![2]!, pinned.sidebar![3]!])
      near(pinned.glass[0], pinned.note)
      await testInfo.attach('shell-on-wall', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })

      // Collapse the sidebar to its rail: the canvas moves, and the glass stays on its window.
      await window.getByTestId('workspace-sidebar-pin').click()
      await expect
        .poll(async () => {
          const state = await readShell(window)
          const band = state.chrome[1]?.[2] ?? -1
          return (
            state.sidebar![2]! < pinned.sidebar![2]! && Math.abs(band - state.sidebar![2]!) <= 1
          )
        })
        .toBe(true)
      await expect
        .poll(async () => {
          const state = await readShell(window)
          const glass = state.glass[0] ?? []
          return glass.every((value, index) => Math.abs(value - state.note![index]!) <= 1)
        })
        .toBe(true)
      const rail = await readShell(window)
      expect(rail.note![0]).toBeLessThan(pinned.note![0]!)
    } finally {
      await electronApp.close()
    }
  })

  test('leaves the shell as it was without the pixel wall, and opaque with solid windows', async ({
    browserName,
  }) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seed(window)
      await expectPaintedWall(window)
      const withWall = await readShell(window)

      await seed(window, { canvasBackgroundStyle: 'minimal' })
      await expect(window.getByTestId('workspace-pixel-wall')).toHaveCount(0)
      const minimal = await readShell(window)
      expect(minimal.layerChildren).toBe(0)
      // The layout does not change with the background.
      expect(minimal.header).toEqual(withWall.header)
      expect(minimal.sidebar).toEqual(withWall.sidebar)
      expect(minimal.main).toEqual(withWall.main)
      expect(minimal.headerFilter).not.toBe('none')

      await seed(window, { windowMaterial: 'solid' })
      await expectPaintedWall(window)
      const solid = await readShell(window)
      expect(solid.headerAlpha).toBe(255)
      expect(solid.sidebarAlpha).toBe(255)

      // The system's reduced transparency makes it opaque too, whatever the setting.
      await seed(window, {}, 'reduce')
      await expectPaintedWall(window)
      await expect.poll(async () => (await readShell(window)).headerAlpha).toBe(255)
      expect((await readShell(window)).sidebarAlpha).toBe(255)
    } finally {
      await electronApp.close()
    }
  })
})
