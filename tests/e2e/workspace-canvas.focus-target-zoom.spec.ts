import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Focus Target Zoom', () => {
  test('focuses nodes to the configured target zoom on click', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'focus-zoom-node',
            title: 'terminal-focus-zoom',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            focusNodeOnClick: true,
            focusNodeTargetZoom: 1.37,
          },
        },
      )

      await expect(window.locator('.workspace-canvas')).toBeVisible()
      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)

      const terminal = window.locator('.terminal-node', { hasText: 'terminal-focus-zoom' }).first()
      const terminalBody = terminal.locator('.terminal-node__terminal')
      await expect(terminalBody).toBeVisible()

      const terminalBox = await terminalBody.boundingBox()
      if (!terminalBox) {
        throw new Error('terminal bounding box unavailable for focus click')
      }

      await window.mouse.click(
        terminalBox.x + terminalBox.width / 2,
        terminalBox.y + Math.min(96, terminalBox.height / 2),
      )

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1.37, 2)
    } finally {
      await electronApp.close()
    }
  })

  test('previews target zoom while dragging slider and restores viewport after release', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'focus-zoom-preview-node',
            title: 'terminal-focus-preview',
            position: { x: 220, y: 180 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            focusNodeOnClick: true,
            focusNodeTargetZoom: 1,
          },
        },
      )

      await expect(window.locator('.workspace-canvas')).toBeVisible()
      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click({ noWaitAfter: true })

      const canvasNav = window.locator('[data-testid="settings-section-nav-canvas"]')
      await expect(canvasNav).toBeVisible()
      await canvasNav.click()

      const focusTargetZoom = window.locator('[data-testid="settings-focus-node-target-zoom"]')
      await expect(focusTargetZoom).toBeVisible()

      const sliderBox = await focusTargetZoom.boundingBox()
      if (!sliderBox) {
        throw new Error('focus target zoom slider bounding box unavailable')
      }

      const sliderMeta = await focusTargetZoom.evaluate(element => {
        const input = element as HTMLInputElement
        return {
          min: Number(input.min),
          max: Number(input.max),
          value: Number(input.value),
        }
      })

      const sliderRange = sliderMeta.max - sliderMeta.min
      if (!Number.isFinite(sliderRange) || sliderRange <= 0) {
        throw new Error(
          `focus target zoom slider range invalid: ${sliderMeta.min}..${sliderMeta.max}`,
        )
      }

      const sliderY = sliderBox.y + sliderBox.height / 2
      const resolveSliderX = (value: number): number => {
        const ratioRaw = (value - sliderMeta.min) / sliderRange
        const ratio = Number.isFinite(ratioRaw) ? ratioRaw : 0
        return sliderBox.x + sliderBox.width * Math.max(0, Math.min(1, ratio))
      }

      const startX = resolveSliderX(sliderMeta.value)
      const targetX = resolveSliderX(1.37)

      await window.mouse.move(startX, sliderY)
      await window.mouse.down()
      await expect(window.locator('.settings-panel')).toHaveClass(/settings-panel--preview/)

      await window.mouse.move(targetX, sliderY)

      const expectedZoom = await focusTargetZoom.evaluate(element => {
        const input = element as HTMLInputElement
        return Number(input.value)
      })
      if (!Number.isFinite(expectedZoom)) {
        throw new Error(`focus target zoom slider value invalid: ${expectedZoom}`)
      }
      if (Math.abs(expectedZoom - sliderMeta.value) < 0.05) {
        throw new Error(
          `focus target zoom slider did not move: start=${sliderMeta.value} next=${expectedZoom}`,
        )
      }

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(expectedZoom, 2)

      await window.mouse.up()
      await expect(window.locator('.settings-panel')).not.toHaveClass(/settings-panel--preview/)
      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeCloseTo(1, 2)
    } finally {
      await electronApp.close()
    }
  })
})
