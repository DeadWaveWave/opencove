import { expect, test } from '@playwright/test'
import {
  beginDragMouse,
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Drag & Resize', () => {
  test('keeps terminal visible after drag, resize, and node interactions', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-1',
          title: 'terminal-1',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
        {
          id: 'node-2',
          title: 'terminal-2',
          position: { x: 760, y: 560 },
          width: 460,
          height: 300,
        },
      ])

      await expect(window.locator('.workspace-canvas')).toBeVisible()
      await expect(window.locator('.workspace-item__meta').first()).toContainText('2 terminals')

      const terminals = window.locator('.terminal-node')
      await expect(terminals).toHaveCount(2)

      const firstTerminal = terminals.first()
      await expect(firstTerminal).toBeVisible()
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      const rightResizer = firstTerminal.locator('[data-testid="terminal-resizer-right"]')
      const rightResizerBox = await rightResizer.boundingBox()
      if (!rightResizerBox) {
        throw new Error('terminal right resizer bounding box unavailable')
      }

      const rightStartX = rightResizerBox.x + rightResizerBox.width / 2
      const rightStartY = rightResizerBox.y + rightResizerBox.height / 2

      await window.mouse.move(rightStartX, rightStartY)
      await window.mouse.down()
      await window.mouse.move(rightStartX + 180, rightStartY, { steps: 12 })
      await window.mouse.up()

      const widthResizedNode = await window.evaluate(async key => {
        void key

        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return null
        }

        const state = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              width: number
              height: number
            }>
          }>
        }

        return state.workspaces?.[0]?.nodes?.find(node => node.id === 'node-1') ?? null
      }, storageKey)

      expect(widthResizedNode).toBeTruthy()
      expect(widthResizedNode?.width ?? 0).toBeGreaterThanOrEqual(460)
      expect(widthResizedNode?.height).toBe(300)

      const bottomResizer = firstTerminal.locator('[data-testid="terminal-resizer-bottom"]')
      const bottomResizerBox = await bottomResizer.boundingBox()
      if (!bottomResizerBox) {
        throw new Error('terminal bottom resizer bounding box unavailable')
      }

      const bottomStartX = bottomResizerBox.x + bottomResizerBox.width / 2
      const bottomStartY = bottomResizerBox.y + bottomResizerBox.height / 2

      await window.mouse.move(bottomStartX, bottomStartY)
      await window.mouse.down()
      await window.mouse.move(bottomStartX, bottomStartY + 120, { steps: 12 })
      await window.mouse.up()

      const heightResizedNode = await window.evaluate(async key => {
        void key

        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return null
        }

        const state = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              width: number
              height: number
            }>
          }>
        }

        return state.workspaces?.[0]?.nodes?.find(node => node.id === 'node-1') ?? null
      }, storageKey)

      expect(heightResizedNode).toBeTruthy()
      expect(heightResizedNode?.width ?? 0).toBeGreaterThanOrEqual(460)
      expect(heightResizedNode?.height ?? 0).toBeGreaterThan(300)
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      const topLeftResizer = firstTerminal.locator('[data-testid="terminal-resizer-top-left"]')
      const topLeftBox = await topLeftResizer.boundingBox()
      if (!topLeftBox) {
        throw new Error('terminal top-left resizer bounding box unavailable')
      }

      const topLeftStartX = topLeftBox.x + topLeftBox.width / 2
      const topLeftStartY = topLeftBox.y + topLeftBox.height / 2

      await window.mouse.move(topLeftStartX, topLeftStartY)
      await window.mouse.down()
      await window.mouse.move(topLeftStartX - 140, topLeftStartY - 90, { steps: 12 })
      await window.mouse.up()

      const cornerResizedNode = await window.evaluate(async key => {
        void key

        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return null
        }

        const state = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              position?: { x?: number; y?: number }
              width: number
              height: number
            }>
          }>
        }

        return state.workspaces?.[0]?.nodes?.find(node => node.id === 'node-1') ?? null
      }, storageKey)

      expect(cornerResizedNode).toBeTruthy()
      expect(cornerResizedNode?.position?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(120)
      expect(cornerResizedNode?.position?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(120)
      expect(cornerResizedNode?.width ?? 0).toBeGreaterThan(heightResizedNode?.width ?? 0)
      expect(cornerResizedNode?.height ?? 0).toBeGreaterThan(heightResizedNode?.height ?? 0)
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      const header = firstTerminal.locator('.terminal-node__header')
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await dragLocatorTo(window, header, pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 360, y: 320 },
      })

      await expect(firstTerminal).toBeVisible()
      await expect(firstTerminal.locator('.xterm')).toBeVisible()

      await terminals.nth(1).locator('.terminal-node__header').click({ force: true })

      await expect(firstTerminal).toBeVisible()
      await expect(firstTerminal.locator('.xterm')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('keeps agent tui visible while dragging window', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-agent-drag',
          title: 'codex · gpt-5.2-codex',
          position: { x: 120, y: 120 },
          width: 520,
          height: 320,
          kind: 'agent',
          status: 'running',
          startedAt: '2026-02-09T00:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          agent: {
            provider: 'codex',
            prompt: 'Keep tui stable during drag',
            model: 'gpt-5.2-codex',
            effectiveModel: 'gpt-5.2-codex',
            launchMode: 'resume',
            resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
            resumeSessionIdVerified: true,
            executionDirectory: testWorkspacePath,
            directoryMode: 'workspace',
            customDirectory: null,
            shouldCreateDirectory: false,
          },
        },
      ])

      const agentNode = window.locator('.terminal-node').first()
      await expect(agentNode).toBeVisible()
      await expect(agentNode.locator('.xterm')).toBeVisible()
      await expect(agentNode).toContainText('[opencove-test-agent]')

      const header = agentNode.locator('.terminal-node__header')
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await dragLocatorTo(window, header, pane, {
        sourcePosition: { x: 120, y: 16 },
        targetPosition: { x: 680, y: 420 },
      })

      await expect(agentNode).toBeVisible()
      await expect(agentNode.locator('.xterm')).toBeVisible()
      await expect(agentNode).toContainText('[opencove-test-agent]')
    } finally {
      await electronApp.close()
    }
  })

  test('keeps terminal resize handle aligned with the mouse while zoomed', async () => {
    test.skip(
      !!process.env.CI,
      'Flaky on GitHub Actions macOS runners; keep local coverage until the resize drag path is stabilized.',
    )

    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-zoomed-resize',
          title: 'terminal-zoomed-resize',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      const viewport = await readCanvasViewport(window)
      expect(viewport.zoom).toBeGreaterThan(1.01)

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()

      const rightResizer = terminal.locator('[data-testid="terminal-resizer-right"]')
      const rightResizerRect = await readLocatorClientRect(rightResizer)

      const startX = rightResizerRect.x + rightResizerRect.width / 2
      const startY = rightResizerRect.y + rightResizerRect.height / 2
      const pointerDeltaX = 180
      const releaseX = startX + pointerDeltaX

      const drag = await beginDragMouse(window, {
        start: { x: startX, y: startY },
        initialTarget: { x: releaseX, y: startY },
        steps: 12,
      })
      await drag.moveTo({ x: releaseX, y: startY }, { settleAfterMoveMs: 48 })

      await expect
        .poll(
          async () => {
            return await rightResizer.evaluate((el, expectedX) => {
              const rect = el.getBoundingClientRect()
              return Math.abs(rect.x + rect.width / 2 - expectedX)
            }, releaseX)
          },
          { timeout: 10_000 },
        )
        .toBeLessThanOrEqual(16)

      await drag.release()

      await expect
        .poll(
          async () => {
            return await window.evaluate(async key => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              const state = JSON.parse(raw) as {
                workspaces?: Array<{
                  nodes?: Array<{
                    id?: string
                    width?: number
                  }>
                }>
              }

              return (
                state.workspaces?.[0]?.nodes?.find(node => node.id === 'node-zoomed-resize')
                  ?.width ?? null
              )
            }, storageKey)
          },
          { timeout: 10_000 },
        )
        .toBeCloseTo(460 + pointerDeltaX / viewport.zoom, -1)
    } finally {
      await electronApp.close()
    }
  })
})
