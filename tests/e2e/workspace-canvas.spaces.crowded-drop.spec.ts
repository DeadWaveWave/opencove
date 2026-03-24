import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  dragLocatorTo,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Crowded Drop)', () => {
  test('expands a crowded space when dropping a window into it', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-full-static-node',
            title: 'terminal-static',
            position: { x: 140, y: 140 },
            width: 460,
            height: 300,
          },
          {
            id: 'space-full-drag-node',
            title: 'terminal-drag',
            position: { x: 140, y: 560 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-full',
              name: 'Full Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-full-static-node'],
              rect: { x: 120, y: 120, width: 520, height: 360 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const draggedNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag' })
        .first()
      await expect(draggedNode).toBeVisible()

      await dragLocatorTo(window, draggedNode.locator('.terminal-node__header'), pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 220, y: 220 },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            async ({ key, spaceId, nodeAId, nodeBId, initialWidth, initialHeight }) => {
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
                    nodeIds?: string[]
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
                !Array.isArray(space.nodeIds) ||
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

              const expanded = space.rect.width > initialWidth || space.rect.height > initialHeight
              const assigned = space.nodeIds.includes(nodeBId)

              return {
                ok: assigned && expanded && nodeAInside && nodeBInside && !overlaps,
                checks: {
                  assigned,
                  expanded,
                  nodeAInside,
                  nodeBInside,
                  overlaps,
                },
                nodeA: {
                  x: nodeA.position.x,
                  y: nodeA.position.y,
                  width: nodeA.width,
                  height: nodeA.height,
                  right: aRight,
                  bottom: aBottom,
                },
                nodeB: {
                  x: nodeB.position.x,
                  y: nodeB.position.y,
                  width: nodeB.width,
                  height: nodeB.height,
                  right: bRight,
                  bottom: bBottom,
                },
                space: {
                  x: space.rect.x,
                  y: space.rect.y,
                  width: space.rect.width,
                  height: space.rect.height,
                  right: spaceRight,
                  bottom: spaceBottom,
                },
              }
            },
            {
              key: storageKey,
              spaceId: 'space-full',
              nodeAId: 'space-full-static-node',
              nodeBId: 'space-full-drag-node',
              initialWidth: 520,
              initialHeight: 360,
            },
          )
        })
        .toEqual(expect.objectContaining({ ok: true }))
    } finally {
      await electronApp.close()
    }
  })

  test('expands a crowded space when dropping multiple selected windows into it', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-multi-static-node',
            title: 'terminal-static',
            position: { x: 140, y: 140 },
            width: 460,
            height: 300,
          },
          {
            id: 'space-multi-intruder-node',
            title: 'terminal-intruder',
            position: { x: 760, y: 200 },
            width: 460,
            height: 300,
          },
          {
            id: 'space-multi-drag-node-a',
            title: 'terminal-drag-a',
            position: { x: 140, y: 560 },
            width: 460,
            height: 300,
          },
          {
            id: 'space-multi-drag-node-b',
            title: 'terminal-drag-b',
            position: { x: 640, y: 560 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-multi-full',
              name: 'Multi Full Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-multi-static-node'],
              rect: { x: 120, y: 120, width: 520, height: 360 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)

      const dragNodeA = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag-a' })
        .first()
      const dragNodeB = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-drag-b' })
        .first()

      await expect(dragNodeA).toBeVisible()
      await expect(dragNodeB).toBeVisible()

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      const dragNodeABox = await dragNodeA.boundingBox()
      if (!dragNodeABox) {
        throw new Error('drag node A bounding box unavailable')
      }

      const dragNodeBBox = await dragNodeB.boundingBox()
      if (!dragNodeBBox) {
        throw new Error('drag node B bounding box unavailable')
      }

      const selectionStartX = Math.max(
        paneBox.x + 20,
        Math.min(dragNodeABox.x, dragNodeBBox.x) - 24,
      )
      const selectionStartY = Math.max(
        paneBox.y + 20,
        Math.min(dragNodeABox.y, dragNodeBBox.y) - 24,
      )
      const selectionEndX = Math.min(
        paneBox.x + paneBox.width - 20,
        Math.max(dragNodeABox.x + dragNodeABox.width, dragNodeBBox.x + dragNodeBBox.width) + 24,
      )
      const selectionEndY = Math.min(
        paneBox.y + paneBox.height - 20,
        Math.max(dragNodeABox.y + dragNodeABox.height, dragNodeBBox.y + dragNodeBBox.height) + 24,
      )

      await dragMouse(window, {
        start: { x: selectionStartX, y: selectionStartY },
        end: { x: selectionEndX, y: selectionEndY },
        steps: 10,
        modifiers: ['Shift'],
        draft: window.locator('.workspace-selection-draft'),
      })

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)

      await expect(window.locator('.react-flow__selection')).toHaveCount(0)
      const spaceRegion = window
        .locator('.workspace-space-region')
        .filter({ hasText: 'Multi Full Scope' })
        .first()
      await expect(spaceRegion).toBeVisible()

      await dragLocatorTo(window, dragNodeB.locator('.terminal-node__header'), spaceRegion, {
        sourcePosition: { x: 80, y: 16 },
      })

      const assertSpaceStable = async (): Promise<{
        ok: boolean
        checks: { assigned: boolean; expanded: boolean; inside: boolean; hasOverlap: boolean }
      } | null> => {
        return await window.evaluate(
          async ({ key, spaceId, nodeAId, nodeBId, initialWidth, initialHeight }) => {
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
                  nodeIds?: string[]
                  rect?: { x?: number; y?: number; width?: number; height?: number } | null
                }>
              }>
            }

            const workspace = parsed.workspaces?.[0]
            const space = workspace?.spaces?.find(item => item.id === spaceId)
            const nodes = workspace?.nodes ?? []

            if (
              !space?.rect ||
              typeof space.rect.x !== 'number' ||
              typeof space.rect.y !== 'number' ||
              typeof space.rect.width !== 'number' ||
              typeof space.rect.height !== 'number' ||
              !Array.isArray(space.nodeIds)
            ) {
              return false
            }

            const nodeById = new Map(nodes.map(node => [node.id ?? '', node]))
            const ownedRects = space.nodeIds
              .map(nodeId => {
                const node = nodeById.get(nodeId)
                if (
                  !node?.position ||
                  typeof node.position.x !== 'number' ||
                  typeof node.position.y !== 'number' ||
                  typeof node.width !== 'number' ||
                  typeof node.height !== 'number'
                ) {
                  return null
                }

                return {
                  left: node.position.x,
                  top: node.position.y,
                  right: node.position.x + node.width,
                  bottom: node.position.y + node.height,
                }
              })
              .filter((rect): rect is NonNullable<typeof rect> => rect !== null)

            const spaceRight = space.rect.x + space.rect.width
            const spaceBottom = space.rect.y + space.rect.height

            const inside = ownedRects.every(rect => {
              return (
                rect.left >= space.rect.x &&
                rect.top >= space.rect.y &&
                rect.right <= spaceRight &&
                rect.bottom <= spaceBottom
              )
            })

            const overlaps = (
              a: (typeof ownedRects)[number],
              b: (typeof ownedRects)[number],
            ): boolean => {
              return !(
                a.right <= b.left ||
                a.left >= b.right ||
                a.bottom <= b.top ||
                a.top >= b.bottom
              )
            }

            let hasOverlap = false
            for (let i = 0; i < ownedRects.length; i += 1) {
              for (let j = i + 1; j < ownedRects.length; j += 1) {
                if (overlaps(ownedRects[i], ownedRects[j])) {
                  hasOverlap = true
                  break
                }
              }
              if (hasOverlap) {
                break
              }
            }

            const expanded = space.rect.width > initialWidth || space.rect.height > initialHeight
            const assigned = space.nodeIds.includes(nodeAId) && space.nodeIds.includes(nodeBId)

            return {
              ok: assigned && expanded && inside && !hasOverlap,
              checks: {
                assigned,
                expanded,
                inside,
                hasOverlap,
              },
            }
          },
          {
            key: storageKey,
            spaceId: 'space-multi-full',
            nodeAId: 'space-multi-drag-node-a',
            nodeBId: 'space-multi-drag-node-b',
            initialWidth: 520,
            initialHeight: 360,
          },
        )
      }

      const waitForSpaceStable = async (
        attemptsRemaining: number,
      ): Promise<NonNullable<Awaited<ReturnType<typeof assertSpaceStable>>>> => {
        const state = await assertSpaceStable()

        if (state?.ok) {
          return state
        }

        if (attemptsRemaining <= 1) {
          return (
            state ?? {
              ok: false,
              checks: { assigned: false, expanded: false, inside: false, hasOverlap: true },
            }
          )
        }

        await window.waitForTimeout(250)
        return await waitForSpaceStable(attemptsRemaining - 1)
      }

      const stable = await waitForSpaceStable(24)
      expect(stable).toEqual(expect.objectContaining({ ok: true }))

      await window.waitForTimeout(350)
      expect(await assertSpaceStable()).toEqual(expect.objectContaining({ ok: true }))

      await expect(window.locator('.react-flow__node.selected')).toHaveCount(2)
      await expect(
        window.locator('.react-flow__node.selected').filter({ hasText: 'terminal-drag-a' }),
      ).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected').filter({ hasText: 'terminal-drag-b' }),
      ).toHaveCount(1)
      await expect(
        window.locator('.react-flow__node.selected').filter({ hasText: 'terminal-static' }),
      ).toHaveCount(0)
      await expect(
        window.locator('.react-flow__node.selected').filter({ hasText: 'terminal-intruder' }),
      ).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
