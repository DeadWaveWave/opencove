import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  clickPaneAtFlowPoint,
  openPaneContextMenuAtFlowPoint,
  openPaneContextMenuInSpace,
  rectsOverlap,
  resolveCanonicalNodeSizes,
} from './workspace-canvas.arrange.shared'

test.describe('Workspace Canvas - Context Menu Note Create', () => {
  test('positions the pane context menu near the pointer and only shifts when it would overflow', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      const viewport = await window.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))

      // Keep this point far enough from all edges so the menu does not need to shift.
      // The menu can grow as new root-level items are added (e.g. quick menu entries).
      const roomyPoint = {
        x: Math.floor(Math.max(80, Math.min(180, paneBox.width - 420))),
        y: Math.floor(Math.max(80, Math.min(180, paneBox.height - 520))),
      }

      await openPaneContextMenuAtFlowPoint(window, pane, roomyPoint)

      const menu = window.locator('.workspace-context-menu').first()
      await expect(menu).toBeVisible()

      const roomyMenuBox = await menu.boundingBox()
      if (!roomyMenuBox) {
        throw new Error('workspace context menu bounding box unavailable')
      }

      const roomyClientX = paneBox.x + roomyPoint.x
      const roomyClientY = paneBox.y + roomyPoint.y

      expect(roomyMenuBox.x).toBeGreaterThanOrEqual(roomyClientX - 1)
      expect(roomyMenuBox.y).toBeGreaterThanOrEqual(roomyClientY - 1)

      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)

      const edgePoint = {
        x: Math.floor(Math.max(40, paneBox.width - 24)),
        y: Math.floor(Math.max(40, paneBox.height - 24)),
      }

      await openPaneContextMenuAtFlowPoint(window, pane, edgePoint)

      await expect(menu).toBeVisible()

      const edgeMenuBox = await menu.boundingBox()
      if (!edgeMenuBox) {
        throw new Error('workspace context menu edge bounding box unavailable')
      }

      const edgeClientX = paneBox.x + edgePoint.x
      const edgeClientY = paneBox.y + edgePoint.y

      expect(edgeMenuBox.x).toBeLessThanOrEqual(edgeClientX)
      expect(edgeMenuBox.y).toBeLessThanOrEqual(edgeClientY)
      expect(edgeMenuBox.x + edgeMenuBox.width).toBeLessThanOrEqual(viewport.width + 12)
      expect(edgeMenuBox.y + edgeMenuBox.height).toBeLessThanOrEqual(viewport.height + 12)
    } finally {
      await electronApp.close()
    }
  })

  test('shows note creation in the blank pane menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 80, y: 80 },
      })

      await expect(window.locator('[data-testid="workspace-context-new-terminal"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-new-note"]')).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-new-task"]')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('creates a note from the blank pane right-click menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 240, y: 180 },
      })

      await window.locator('[data-testid="workspace-context-new-note"]').click()

      const noteNode = window.locator('.note-node').first()
      await expect(noteNode).toBeVisible()
      await expect(noteNode.locator('[data-testid="note-node-title"]')).toHaveText('note')
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)

      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return 0
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: Array<{
                  kind?: string
                }>
              }>
            }

            return parsed.workspaces?.[0]?.nodes?.filter(node => node.kind === 'note').length ?? 0
          })
        })
        .toBe(1)
    } finally {
      await electronApp.close()
    }
  })

  test('creates an empty space from the blank pane right-click menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 260, y: 200 },
      })

      await window.locator('[data-testid="workspace-context-create-empty-space"]').click()

      await expect(window.locator('.workspace-space-region')).toHaveCount(1)
      await expect(window.locator('.terminal-node')).toHaveCount(0)
      await expect(window.locator('.note-node')).toHaveCount(0)
      await expect(window.locator('.task-node')).toHaveCount(0)
      await expect(window.locator('.agent-node')).toHaveCount(0)

      await expect
        .poll(async () => {
          return await window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            if (!raw) {
              return { spaceCount: 0, nodeCount: 0, firstSpaceNodeIdsCount: null }
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{
                nodes?: unknown[]
                spaces?: Array<{ nodeIds?: string[] }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const firstSpace = workspace?.spaces?.[0]

            return {
              spaceCount: workspace?.spaces?.length ?? 0,
              nodeCount: workspace?.nodes?.length ?? 0,
              firstSpaceNodeIdsCount: firstSpace?.nodeIds?.length ?? null,
            }
          })
        })
        .toEqual({
          spaceCount: 1,
          nodeCount: 0,
          firstSpaceNodeIdsCount: 0,
        })
    } finally {
      await electronApp.close()
    }
  })

  test('does not offer empty space creation from the pane menu when right-clicking inside a space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        spaces: [
          {
            id: 'context-space-guard',
            name: 'Context Scope',
            directoryPath: testWorkspacePath,
            nodeIds: [],
            rect: { x: 120, y: 120, width: 780, height: 540 },
          },
        ],
        activeSpaceId: null,
      })

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await openPaneContextMenuInSpace(window, pane, 'context-space-guard')

      await expect(
        window.locator('[data-testid="workspace-context-create-empty-space"]'),
      ).toHaveCount(0)
      await expect(window.locator('[data-testid="workspace-context-new-terminal"]')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('places created empty spaces in available canvas room (does not overlap existing windows)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'occupied-window',
          title: 'terminal-occupied',
          position: { x: 220, y: 180 },
          width: 460,
          height: 300,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await openPaneContextMenuAtFlowPoint(window, pane, { x: 210, y: 170 })
      await window.locator('[data-testid="workspace-context-create-empty-space"]').click()

      const canonicalSizes = await resolveCanonicalNodeSizes(window)

      await expect
        .poll(async () => {
          const layout = await window.evaluate(async () => {
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
                  rect?: { x?: number; y?: number; width?: number; height?: number } | null
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const node = workspace?.nodes?.find(candidate => candidate.id === 'occupied-window')
            const spaces = workspace?.spaces ?? []
            const spaceRect = spaces.length > 0 ? (spaces[spaces.length - 1]?.rect ?? null) : null

            if (!node?.position || !spaceRect) {
              return null
            }

            return {
              node: {
                x: node.position.x ?? 0,
                y: node.position.y ?? 0,
                width: node.width ?? 0,
                height: node.height ?? 0,
              },
              space: {
                x: spaceRect.x ?? 0,
                y: spaceRect.y ?? 0,
                width: spaceRect.width ?? 0,
                height: spaceRect.height ?? 0,
              },
            }
          })

          if (!layout) {
            return null
          }

          return {
            overlap: rectsOverlap(layout.node, layout.space),
            meetsMin:
              layout.space.width >= canonicalSizes.agent.width &&
              layout.space.height >= canonicalSizes.agent.height,
          }
        })
        .toEqual({ overlap: false, meetsMin: true })
    } finally {
      await electronApp.close()
    }
  })

  test('centers the viewport on the newly created empty space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'giant-blocker',
          title: 'terminal-giant-blocker',
          position: { x: 0, y: 0 },
          width: 2600,
          height: 1800,
        },
      ])

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const viewport = await window.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }))

      await openPaneContextMenuAtFlowPoint(window, pane, { x: 220, y: 200 })
      await window.locator('[data-testid="workspace-context-create-empty-space"]').click()

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toHaveCount(1)

      await expect
        .poll(async () => {
          const rect = await readLocatorClientRect(spaceRegion)
          const centerX = rect.x + rect.width / 2
          const centerY = rect.y + rect.height / 2
          const dx = Math.abs(centerX - viewport.width / 2)
          const dy = Math.abs(centerY - viewport.height / 2)
          const isOnscreen =
            centerX >= 0 && centerX <= viewport.width && centerY >= 0 && centerY <= viewport.height
          const isNearCenter = dx < viewport.width * 0.35 && dy < viewport.height * 0.35

          return {
            isOnscreen,
            isNearCenter,
          }
        })
        .toEqual({ isOnscreen: true, isNearCenter: true })
    } finally {
      await electronApp.close()
    }
  })
})
