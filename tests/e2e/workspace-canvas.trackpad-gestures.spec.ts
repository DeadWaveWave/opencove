import { expect, test } from '@playwright/test'
import {
  buildEchoSequenceCommand,
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
} from './workspace-canvas.helpers'

type WorkspaceWindow = Awaited<ReturnType<typeof launchApp>>['window']

async function readResolvedCanvasInputMode(window: WorkspaceWindow): Promise<string | null> {
  return await window.locator('.workspace-canvas').getAttribute('data-canvas-input-mode')
}

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

test.describe('Workspace Canvas - Trackpad Gestures', () => {
  test('auto mode switches to trackpad interaction after gesture-like wheel input', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'auto-trackpad-select-node',
          title: 'terminal-auto-trackpad-select',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      await window.evaluate(() => {
        const paneElement = document.querySelector('.workspace-canvas .react-flow__pane')
        if (!(paneElement instanceof HTMLElement)) {
          return
        }

        const dispatch = (deltaX: number, deltaY: number, ctrlKey: boolean): void => {
          paneElement.dispatchEvent(
            new WheelEvent('wheel', {
              deltaX,
              deltaY,
              deltaMode: 0,
              ctrlKey,
              bubbles: true,
              cancelable: true,
            }),
          )
        }

        dispatch(0, 2, true)
        dispatch(1.1, 1.8, false)
        dispatch(1, 1.5, false)
      })

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      await dragMouse(window, {
        start: { x: paneBox.x + 80, y: paneBox.y + 80 },
        end: { x: paneBox.x + 760, y: paneBox.y + 560 },
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(1)
    } finally {
      await electronApp.close()
    }
  })

  test('auto mode pans canvas on gesture-like scroll input', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'auto-trackpad-pan-node',
          title: 'terminal-auto-trackpad-pan',
          position: { x: 320, y: 220 },
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
        deltaX: 6.5,
        deltaY: 9.25,
        deltaMode: 0,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'trackpad')
      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return Math.hypot(current.x - before.x, current.y - before.y)
        })
        .toBeGreaterThan(4)
    } finally {
      await electronApp.close()
    }
  })

  test('locks trackpad pan target to canvas across contiguous wheel gestures', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'trackpad-pan-lock-node',
            title: 'terminal-trackpad-pan-lock',
            position: { x: 320, y: 260 },
            width: 460,
            height: 300,
          },
        ],
        {
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const terminal = window.locator('.terminal-node').first()
      await expect(pane).toBeVisible()
      await expect(terminal).toBeVisible()
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }
      const terminalBox = await terminal.boundingBox()
      if (!terminalBox) {
        throw new Error('terminal node bounding box unavailable')
      }

      const before = await readCanvasViewport(window)

      await window.mouse.move(paneBox.x + 120, paneBox.y + 120)
      await window.mouse.wheel(120, 0)

      await window.mouse.move(terminalBox.x + 80, terminalBox.y + 80)
      await window.mouse.wheel(120, 0)

      await expect
        .poll(async () => {
          const current = await readCanvasViewport(window)
          return Math.abs(current.x - before.x)
        })
        .toBeGreaterThan(80)
    } finally {
      await electronApp.close()
    }
  })

  test('restores terminal wheel scrolling after a trackpad pan gesture gap', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'trackpad-terminal-scroll-after-pan',
            title: 'terminal-trackpad-scroll-after-pan',
            position: { x: 240, y: 200 },
            width: 520,
            height: 320,
          },
        ],
        {
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const terminal = window.locator('.terminal-node').first()
      await expect(pane).toBeVisible()
      await expect(terminal).toBeVisible()

      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await window.keyboard.type(buildEchoSequenceCommand('TRACKPAD_SCROLL', 260))
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('TRACKPAD_SCROLL_260')

      await window.evaluate(() => {
        const paneElement = document.querySelector('.workspace-canvas .react-flow__pane')
        if (!(paneElement instanceof HTMLElement)) {
          return
        }

        paneElement.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: 160,
            deltaY: 24,
            deltaMode: 0,
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      await window.waitForTimeout(280)
      const beforeViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'trackpad-terminal-scroll-after-pan')

      await terminal.hover()
      await window.mouse.wheel(0, -900)
      await window.waitForTimeout(120)

      const afterViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'trackpad-terminal-scroll-after-pan')
      expect(beforeViewportY).not.toBeNull()
      expect(afterViewportY).not.toBeNull()
      expect(afterViewportY).toBeLessThan(beforeViewportY as number)
    } finally {
      await electronApp.close()
    }
  })

  test('auto mode keeps trackpad canvas behavior while mouse wheel scrolls terminal', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'auto-terminal-wheel-scroll-node',
          title: 'terminal-auto-terminal-wheel-scroll',
          position: { x: 240, y: 200 },
          width: 520,
          height: 320,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const canvas = window.locator('.workspace-canvas')
      const terminal = window.locator('.terminal-node').first()
      await expect(pane).toBeVisible()
      await expect(terminal).toBeVisible()

      await dispatchCanvasWheel(window, {
        deltaX: 0,
        deltaY: 2,
        deltaMode: 0,
        ctrlKey: true,
      })

      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'trackpad')

      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      await xterm.click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()
      await window.keyboard.type(buildEchoSequenceCommand('AUTO_WHEEL_SCROLL', 260))
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('AUTO_WHEEL_SCROLL_260')
      const beforeViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'auto-terminal-wheel-scroll-node')

      await terminal.hover()
      await window.mouse.wheel(0, -900)
      await window.waitForTimeout(120)

      const afterViewportY = await window.evaluate(nodeId => {
        return window.__opencoveTerminalSelectionTestApi?.getViewportY(nodeId) ?? null
      }, 'auto-terminal-wheel-scroll-node')
      expect(beforeViewportY).not.toBeNull()
      expect(afterViewportY).not.toBeNull()
      expect(afterViewportY).toBeLessThan(beforeViewportY as number)
      await expect(canvas).toHaveAttribute('data-canvas-input-mode', 'trackpad')
      expect(await readResolvedCanvasInputMode(window)).toBe('trackpad')
    } finally {
      await electronApp.close()
    }
  })

  test('uses pointer location as zoom anchor for trackpad pinch', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'trackpad-pinch-anchor-node',
            title: 'terminal-trackpad-pinch-anchor',
            position: { x: 420, y: 300 },
            width: 520,
            height: 320,
          },
        ],
        {
          settings: {
            canvasInputMode: 'trackpad',
          },
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const initialViewport = await readCanvasViewport(window)

      const invariants = await window.evaluate(initial => {
        const paneElement = document.querySelector('.workspace-canvas .react-flow__pane')
        if (!(paneElement instanceof HTMLElement)) {
          return null
        }

        const rect = paneElement.getBoundingClientRect()
        const anchorClientX = rect.left + rect.width * 0.82
        const anchorClientY = rect.top + rect.height * 0.26
        const anchorLocalX = anchorClientX - rect.left
        const anchorLocalY = anchorClientY - rect.top

        const flowBefore = {
          x: (anchorLocalX - initial.x) / initial.zoom,
          y: (anchorLocalY - initial.y) / initial.zoom,
        }

        paneElement.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: 0,
            deltaY: -120,
            deltaMode: 0,
            ctrlKey: true,
            clientX: anchorClientX,
            clientY: anchorClientY,
            bubbles: true,
            cancelable: true,
          }),
        )

        return {
          anchorLocalX,
          anchorLocalY,
          flowBefore,
        }
      }, initialViewport)

      if (!invariants) {
        throw new Error('workspace pane element unavailable for pinch anchor test')
      }

      const nextViewport = await readCanvasViewport(window)
      expect(nextViewport.zoom).toBeGreaterThan(initialViewport.zoom)

      const flowAfter = {
        x: (invariants.anchorLocalX - nextViewport.x) / nextViewport.zoom,
        y: (invariants.anchorLocalY - nextViewport.y) / nextViewport.zoom,
      }

      expect(Math.abs(flowAfter.x - invariants.flowBefore.x)).toBeLessThan(0.6)
      expect(Math.abs(flowAfter.y - invariants.flowBefore.y)).toBeLessThan(0.6)
    } finally {
      await electronApp.close()
    }
  })
})
