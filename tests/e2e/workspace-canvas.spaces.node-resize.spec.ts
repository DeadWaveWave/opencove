import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Node Resize)', () => {
  test('expands the space and keeps root windows clear when resizing a node outward', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-resize-terminal',
            title: 'terminal-in-space',
            position: { x: 140, y: 140 },
            width: 460,
            height: 300,
            kind: 'terminal',
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            executionDirectory: testWorkspacePath,
            expectedDirectory: testWorkspacePath,
            agent: null,
            task: null,
          },
          {
            id: 'root-blocking-resize',
            title: 'root-blocking-resize',
            position: { x: 740, y: 140 },
            width: 460,
            height: 300,
            kind: 'terminal',
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            executionDirectory: testWorkspacePath,
            expectedDirectory: testWorkspacePath,
            agent: null,
            task: null,
          },
        ],
        {
          spaces: [
            {
              id: 'space-resize',
              name: 'Resize Space',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-resize-terminal'],
              rect: { x: 100, y: 100, width: 600, height: 400 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const terminalNode = window
        .locator('.terminal-node', { hasText: 'terminal-in-space' })
        .first()
      await expect(terminalNode).toBeVisible()

      const rightResizer = terminalNode.locator('[data-testid="terminal-resizer-right"]')
      const rightBox = await rightResizer.boundingBox()
      if (!rightBox) {
        throw new Error('terminal right resizer bounding box unavailable')
      }

      await dragMouse(window, {
        start: { x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2 },
        end: {
          x: rightBox.x + rightBox.width / 2 + 800,
          y: rightBox.y + rightBox.height / 2,
        },
        steps: 14,
      })

      const bottomResizer = terminalNode.locator('[data-testid="terminal-resizer-bottom"]')
      const bottomBox = await bottomResizer.boundingBox()
      if (!bottomBox) {
        throw new Error('terminal bottom resizer bounding box unavailable')
      }

      await dragMouse(window, {
        start: { x: bottomBox.x + bottomBox.width / 2, y: bottomBox.y + bottomBox.height / 2 },
        end: {
          x: bottomBox.x + bottomBox.width / 2,
          y: bottomBox.y + bottomBox.height / 2 + 360,
        },
        steps: 12,
      })

      const initialSpaceRect = { x: 100, y: 100, width: 600, height: 400 }
      const initialMaxWidth = initialSpaceRect.x + initialSpaceRect.width - 140
      const initialMaxHeight = initialSpaceRect.y + initialSpaceRect.height - 140

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              async ({ key, maxWidth, maxHeight }) => {
                void key

                const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
                if (!raw) {
                  return null
                }

                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    nodes?: Array<{
                      id?: string
                      position?: { x?: number; y?: number }
                      width?: number
                      height?: number
                    }>
                    spaces?: Array<{
                      id?: string
                      rect?: { x?: number; y?: number; width?: number; height?: number } | null
                    }>
                  }>
                }

                const workspace = parsed.workspaces?.[0]
                const node = (workspace?.nodes ?? []).find(
                  item => item.id === 'space-resize-terminal',
                )
                const root = (workspace?.nodes ?? []).find(
                  item => item.id === 'root-blocking-resize',
                )
                const rect =
                  (workspace?.spaces ?? []).find(item => item.id === 'space-resize')?.rect ?? null

                if (
                  !node?.position ||
                  typeof node.position.x !== 'number' ||
                  typeof node.position.y !== 'number' ||
                  typeof node.width !== 'number' ||
                  typeof node.height !== 'number' ||
                  !root?.position ||
                  typeof root.position.x !== 'number' ||
                  typeof root.position.y !== 'number' ||
                  typeof root.width !== 'number' ||
                  typeof root.height !== 'number' ||
                  !rect ||
                  typeof rect.x !== 'number' ||
                  typeof rect.y !== 'number' ||
                  typeof rect.width !== 'number' ||
                  typeof rect.height !== 'number'
                ) {
                  return null
                }

                const nodeRight = node.position.x + node.width
                const nodeBottom = node.position.y + node.height
                const spaceRight = rect.x + rect.width
                const spaceBottom = rect.y + rect.height
                const rootRight = root.position.x + root.width
                const rootBottom = root.position.y + root.height

                const spaceExpanded = rect.width > 600 && rect.height > 400
                const nodeNotClamped =
                  node.width > maxWidth && node.height > maxHeight && node.width > 460

                const nodeInsideSpace =
                  node.position.x >= rect.x &&
                  node.position.y >= rect.y &&
                  nodeRight <= spaceRight &&
                  nodeBottom <= spaceBottom

                const rootClearOfExpandedSpace =
                  rootRight <= rect.x ||
                  root.position.x >= spaceRight ||
                  rootBottom <= rect.y ||
                  root.position.y >= spaceBottom

                const ok =
                  node.position.x === 140 &&
                  node.position.y === 140 &&
                  spaceExpanded &&
                  nodeNotClamped &&
                  nodeInsideSpace &&
                  rootClearOfExpandedSpace

                return {
                  ok,
                  node: {
                    x: node.position.x,
                    y: node.position.y,
                    width: node.width,
                    height: node.height,
                    right: nodeRight,
                    bottom: nodeBottom,
                  },
                  space: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    right: spaceRight,
                    bottom: spaceBottom,
                  },
                  root: {
                    x: root.position.x,
                    y: root.position.y,
                  },
                  checks: {
                    spaceExpanded,
                    nodeNotClamped,
                    nodeInsideSpace,
                    rootClearOfExpandedSpace,
                  },
                }
              },
              { key: storageKey, maxWidth: initialMaxWidth, maxHeight: initialMaxHeight },
            )
          },
          { timeout: 10_000 },
        )
        .toEqual(expect.objectContaining({ ok: true }))
    } finally {
      await electronApp.close()
    }
  })
})
