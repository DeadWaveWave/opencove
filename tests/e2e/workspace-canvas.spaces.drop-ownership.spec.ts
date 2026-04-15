import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragLocatorTo,
  launchApp,
  readLocatorClientRect,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Drop Ownership)', () => {
  test('moves nodes into/out of a space based on drop location', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-owned-node',
            title: 'terminal-owned',
            position: { x: 360, y: 260 },
            width: 460,
            height: 300,
          },
          {
            id: 'root-movable-node',
            title: 'terminal-root',
            position: { x: 120, y: 120 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-ownership',
              name: 'Ownership Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-owned-node'],
              rect: { x: 320, y: 220, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const clamp = (value: number, min: number, max: number): number =>
        Math.max(min, Math.min(max, value))

      const paneBox = await readLocatorClientRect(pane)
      const spaceRegion = window
        .locator('.workspace-space-region')
        .filter({ hasText: 'Ownership Scope' })
        .first()
      const spaceBox = await readLocatorClientRect(spaceRegion)

      const rootNode = window.locator('.terminal-node').filter({ hasText: 'terminal-root' }).first()
      await expect(rootNode).toBeVisible()

      const dropInsideSpaceClientPoint = {
        x: spaceBox.x + spaceBox.width / 2,
        y: spaceBox.y + Math.min(spaceBox.height - 80, Math.max(140, spaceBox.height / 2)),
      }

      await dragLocatorTo(window, rootNode.locator('.terminal-node__header'), pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: {
          x: clamp(dropInsideSpaceClientPoint.x - paneBox.x, 40, paneBox.width - 40),
          y: clamp(dropInsideSpaceClientPoint.y - paneBox.y, 40, paneBox.height - 40),
        },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            async ({ key, spaceId, nodeId }) => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return false
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  spaces?: Array<{
                    id?: string
                    nodeIds?: string[]
                  }>
                }>
              }

              const space = parsed.workspaces?.[0]?.spaces?.find(item => item.id === spaceId)
              return Boolean(space?.nodeIds?.includes(nodeId))
            },
            {
              key: storageKey,
              spaceId: 'space-ownership',
              nodeId: 'root-movable-node',
            },
          )
        })
        .toBe(true)

      await expect(spaceRegion).toBeVisible()
      const refreshedSpaceBox = await readLocatorClientRect(spaceRegion)
      const spaceBottom = refreshedSpaceBox.y + refreshedSpaceBox.height
      const safeDropY = Math.min(paneBox.y + paneBox.height - 24, spaceBottom + 120)

      await dragLocatorTo(window, rootNode.locator('.terminal-node__header'), pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: {
          x: clamp(80, 40, paneBox.width - 40),
          y: clamp(safeDropY - paneBox.y, 40, paneBox.height - 40),
        },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            async ({ key, spaceId, nodeId }) => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  spaces?: Array<{
                    id?: string
                    nodeIds?: string[]
                  }>
                }>
              }

              const space = parsed.workspaces?.[0]?.spaces?.find(item => item.id === spaceId)
              return space?.nodeIds?.includes(nodeId) ?? null
            },
            {
              key: storageKey,
              spaceId: 'space-ownership',
              nodeId: 'root-movable-node',
            },
          )
        })
        .toBe(false)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps dropped nodes fully inside the target space bounds (no straddling)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-boundary-node',
            title: 'terminal-boundary',
            position: { x: 420, y: 340 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-boundary',
              name: 'Boundary Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-boundary-node'],
              rect: { x: 340, y: 280, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const boundaryNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-boundary' })
        .first()
      await expect(boundaryNode).toBeVisible()

      await dragLocatorTo(window, boundaryNode.locator('.terminal-node__header'), pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 350, y: 340 },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            async ({ key, nodeId, spaceId }) => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return false
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
              const node = workspace?.nodes?.find(item => item.id === nodeId)
              const space = workspace?.spaces?.find(item => item.id === spaceId)

              if (
                !node?.position ||
                typeof node.position.x !== 'number' ||
                typeof node.position.y !== 'number' ||
                typeof node.width !== 'number' ||
                typeof node.height !== 'number' ||
                !space?.rect ||
                typeof space.rect.x !== 'number' ||
                typeof space.rect.y !== 'number' ||
                typeof space.rect.width !== 'number' ||
                typeof space.rect.height !== 'number'
              ) {
                return false
              }

              const nodeRight = node.position.x + node.width
              const nodeBottom = node.position.y + node.height
              const spaceRight = space.rect.x + space.rect.width
              const spaceBottom = space.rect.y + space.rect.height

              return (
                node.position.x >= space.rect.x &&
                node.position.y >= space.rect.y &&
                nodeRight <= spaceRight &&
                nodeBottom <= spaceBottom
              )
            },
            { key: storageKey, nodeId: 'space-boundary-node', spaceId: 'space-boundary' },
          )
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('prevents overlaps when drop clamping moves nodes inside a space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-overlap-static-node',
            title: 'terminal-static',
            position: { x: 360, y: 220 },
            width: 460,
            height: 300,
          },
          {
            id: 'space-overlap-drag-node',
            title: 'terminal-drag',
            position: { x: 360, y: 260 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-overlap',
              name: 'Overlap Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-overlap-static-node', 'space-overlap-drag-node'],
              rect: { x: 200, y: 200, width: 1200, height: 600 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const spaceRegion = window
        .locator('.workspace-space-region')
        .filter({ hasText: 'Overlap Scope' })
        .first()
      await expect(spaceRegion).toBeVisible()
      const spaceBox = await readLocatorClientRect(spaceRegion)
      const draggedNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag' })
        .first()
      await expect(draggedNode).toBeVisible()

      await dragLocatorTo(window, draggedNode.locator('.terminal-node__header'), spaceRegion, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: {
          x: Math.min(Math.max(220, Math.round(spaceBox.width * 0.28)), spaceBox.width - 60),
          y: Math.min(Math.max(320, Math.round(spaceBox.height * 0.6)), spaceBox.height - 160),
        },
        steps: 18,
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            async ({ key, spaceId, nodeAId, nodeBId }) => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return false
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
              const space = workspace?.spaces?.find(item => item.id === spaceId)
              const nodes = workspace?.nodes ?? []
              const nodeA = nodes.find(item => item.id === nodeAId)
              const nodeB = nodes.find(item => item.id === nodeBId)

              if (
                !space?.rect ||
                typeof space.rect.x !== 'number' ||
                typeof space.rect.y !== 'number' ||
                typeof space.rect.width !== 'number' ||
                typeof space.rect.height !== 'number' ||
                !nodeA?.position ||
                typeof nodeA.position.x !== 'number' ||
                typeof nodeA.position.y !== 'number' ||
                typeof nodeA.width !== 'number' ||
                typeof nodeA.height !== 'number' ||
                !nodeB?.position ||
                typeof nodeB.position.x !== 'number' ||
                typeof nodeB.position.y !== 'number' ||
                typeof nodeB.width !== 'number' ||
                typeof nodeB.height !== 'number'
              ) {
                return false
              }

              const spaceRight = space.rect.x + space.rect.width
              const spaceBottom = space.rect.y + space.rect.height

              const aLeft = nodeA.position.x
              const aTop = nodeA.position.y
              const aRight = nodeA.position.x + nodeA.width
              const aBottom = nodeA.position.y + nodeA.height

              const bLeft = nodeB.position.x
              const bTop = nodeB.position.y
              const bRight = nodeB.position.x + nodeB.width
              const bBottom = nodeB.position.y + nodeB.height

              const nodeAInside =
                aLeft >= space.rect.x &&
                aTop >= space.rect.y &&
                aRight <= spaceRight &&
                aBottom <= spaceBottom

              const nodeBInside =
                bLeft >= space.rect.x &&
                bTop >= space.rect.y &&
                bRight <= spaceRight &&
                bBottom <= spaceBottom

              const overlaps = !(
                aRight <= bLeft ||
                aLeft >= bRight ||
                aBottom <= bTop ||
                aTop >= bBottom
              )

              return nodeAInside && nodeBInside && !overlaps
            },
            {
              key: storageKey,
              spaceId: 'space-overlap',
              nodeAId: 'space-overlap-static-node',
              nodeBId: 'space-overlap-drag-node',
            },
          )
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })
})
