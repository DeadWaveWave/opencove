import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, readCanvasViewport } from './workspace-canvas.helpers'

type WorkspaceWindow = Awaited<ReturnType<typeof launchApp>>['window']

async function dispatchCanvasWheel(
  window: WorkspaceWindow,
  eventInit: Partial<WheelEventInit>,
): Promise<void> {
  await window.evaluate(event => {
    const paneElement = document.querySelector('.workspace-canvas .react-flow__pane')
    if (!(paneElement instanceof HTMLElement)) {
      return
    }

    paneElement.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        ...event,
      }),
    )
  }, eventInit)
}

test.describe('Workspace Canvas - Auto Switch Wheel', () => {
  test('auto mode keeps mouse zoom across repeated ambiguous vertical pixel wheel input', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'auto-ambiguous-vertical-wheel-node',
          title: 'terminal-auto-ambiguous-vertical-wheel',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const canvas = window.locator('.workspace-canvas')
      await expect(pane).toBeVisible()
      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'mouse')

      const before = await readCanvasViewport(window)

      await dispatchCanvasWheel(window, {
        deltaX: 0,
        deltaY: -4.5,
        deltaMode: 0,
      })
      await dispatchCanvasWheel(window, {
        deltaX: 0,
        deltaY: -4.25,
        deltaMode: 0,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'mouse')
      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return current.zoom - before.zoom
        })
        .toBeGreaterThan(0.004)
    } finally {
      await electronApp.close()
    }
  })

  test('auto mode still zooms on large noisy mouse-wheel input', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'auto-large-wheel-zoom-node',
          title: 'terminal-auto-large-wheel-zoom',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const canvas = window.locator('.workspace-canvas')
      await expect(pane).toBeVisible()
      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'mouse')

      await dispatchCanvasWheel(window, {
        deltaX: 5.5,
        deltaY: 7.25,
        deltaMode: 0,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'trackpad')

      const beforeMouseWheel = await readCanvasViewport(window)

      await dispatchCanvasWheel(window, {
        deltaX: 2.5,
        deltaY: -96,
        deltaMode: 0,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'mouse')
      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return current.zoom - beforeMouseWheel.zoom
        })
        .toBeGreaterThan(0.08)
    } finally {
      await electronApp.close()
    }
  })

  test('auto mode restores mouse-wheel zoom immediately after trackpad use', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'auto-mouse-wheel-switch-node',
          title: 'terminal-auto-mouse-wheel-switch',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const canvas = window.locator('.workspace-canvas')
      await expect(pane).toBeVisible()
      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'mouse')

      await dispatchCanvasWheel(window, {
        deltaX: 5.5,
        deltaY: 7.25,
        deltaMode: 0,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'trackpad')

      const beforeMouseWheel = await readCanvasViewport(window)

      await dispatchCanvasWheel(window, {
        deltaX: 0,
        deltaY: -120,
        deltaMode: 0,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'mouse')
      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return current.zoom - beforeMouseWheel.zoom
        })
        .toBeGreaterThan(0.1)
    } finally {
      await electronApp.close()
    }
  })
})
