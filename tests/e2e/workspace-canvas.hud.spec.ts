import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

async function seed(window: Page, canvasFarViewEnabled = true) {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: 'hud-note',
        title: 'HUD note',
        kind: 'note',
        position: { x: 200, y: 160 },
        width: 320,
        height: 220,
        task: { text: 'The HUD switches between far and near.' },
      },
      {
        id: 'hud-far-note',
        title: 'Far note',
        kind: 'note',
        position: { x: 2600, y: 1800 },
        width: 320,
        height: 220,
        task: { text: 'Out of view at 100%.' },
      },
    ],
    { settings: { language: 'en', canvasFarViewEnabled } },
  )
}

test('the canvas HUD switches between far and near view and shows the zoom', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await seed(window)
    const hud = window.getByTestId('workspace-canvas-hud')
    const zoom = window.getByTestId('workspace-canvas-hud-zoom')
    const canvas = window.locator('.workspace-canvas')
    await expect(hud).toBeVisible()
    const start = await readCanvasViewport(window)
    await expect(zoom).toHaveText(`${Math.round(start.zoom * 100)}%`)
    await expect(window.getByTestId('workspace-canvas-hud-lod-near')).toBeChecked()

    await window.getByTestId('workspace-canvas-hud-lod-far').check()
    await expect(canvas).toHaveAttribute('data-cove-lod', 'far')
    await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeLessThanOrEqual(0.2)
    await expect(window.getByTestId('workspace-canvas-hud-lod-far')).toBeChecked()
    const far = await readCanvasViewport(window)
    await expect(zoom).toHaveText(`${Math.round(far.zoom * 100)}%`)

    await window.getByTestId('workspace-canvas-hud-lod-near').check()
    await expect(canvas).toHaveAttribute('data-cove-lod', 'near')
    await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeCloseTo(1, 2)
    await expect(zoom).toHaveText('100%')
  } finally {
    await electronApp.close()
  }
})

test('the HUD keeps only the zoom when far view is off', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await seed(window, false)
    await expect(window.getByTestId('workspace-canvas-hud-zoom')).toBeVisible()
    await expect(window.getByTestId('workspace-canvas-hud-lod')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
