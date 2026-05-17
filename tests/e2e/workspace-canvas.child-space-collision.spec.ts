import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  contains,
  dragSpaceTopHandle,
  fitWorkspaceView,
  overlaps,
  readChildSpaceSnapshot as readSnapshot,
} from './workspace-canvas.child-space.helpers'

test.describe('Workspace Canvas - Child Space Collision', () => {
  test('moves child space content with parent while keeping root blockers clear', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'child-collision-node',
            title: 'terminal-child-collision-node',
            position: { x: 410, y: 320 },
            width: 180,
            height: 120,
          },
          {
            id: 'child-root-blocker',
            title: 'terminal-child-root-blocker',
            position: { x: 980, y: 280 },
            width: 320,
            height: 220,
          },
        ],
        {
          spaces: [
            {
              id: 'child-collision-parent',
              name: 'Child Collision Parent',
              directoryPath: testWorkspacePath,
              nodeIds: [],
              rect: { x: 300, y: 220, width: 560, height: 380 },
            },
            {
              id: 'child-collision-child',
              name: 'Child Collision Child',
              directoryPath: testWorkspacePath,
              parentSpaceId: 'child-collision-parent',
              nodeIds: ['child-collision-node'],
              rect: { x: 380, y: 290, width: 260, height: 190 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await fitWorkspaceView(window)
      const before = await readSnapshot(window)
      const dragHandle = window.locator(
        '[data-testid="workspace-space-drag-child-collision-parent-top"]',
      )
      await expect(dragHandle).toBeVisible()
      await dragSpaceTopHandle(window, dragHandle, { x: 760, y: 0 })

      await expect
        .poll(async () => {
          const after = await readSnapshot(window)
          const parent = after.spaces['child-collision-parent']
          const child = after.spaces['child-collision-child']
          const childNode = after.nodes['child-collision-node']
          const blocker = after.nodes['child-root-blocker']
          if (!parent || !child || !childNode || !blocker) {
            return null
          }

          const parentDx = parent.x - before.spaces['child-collision-parent'].x
          const parentDy = parent.y - before.spaces['child-collision-parent'].y

          return {
            parentMoved: parentDx > 300,
            childDx: child.x - before.spaces['child-collision-child'].x,
            childDy: child.y - before.spaces['child-collision-child'].y,
            childNodeDx: childNode.x - before.nodes['child-collision-node'].x,
            childNodeDy: childNode.y - before.nodes['child-collision-node'].y,
            parentDx,
            parentDy,
            childInsideParent: contains(parent, child, 12),
            blockerClearOfParent: !overlaps(blocker, parent),
            blockerClearOfChild: !overlaps(blocker, child),
          }
        })
        .toEqual(
          expect.objectContaining({
            parentMoved: true,
            childInsideParent: true,
            blockerClearOfParent: true,
            blockerClearOfChild: true,
          }),
        )

      const after = await readSnapshot(window)
      const parentDx =
        after.spaces['child-collision-parent'].x - before.spaces['child-collision-parent'].x
      const parentDy =
        after.spaces['child-collision-parent'].y - before.spaces['child-collision-parent'].y
      expect(
        after.spaces['child-collision-child'].x - before.spaces['child-collision-child'].x,
      ).toBe(parentDx)
      expect(
        after.spaces['child-collision-child'].y - before.spaces['child-collision-child'].y,
      ).toBe(parentDy)
      expect(after.nodes['child-collision-node'].x - before.nodes['child-collision-node'].x).toBe(
        parentDx,
      )
      expect(after.nodes['child-collision-node'].y - before.nodes['child-collision-node'].y).toBe(
        parentDy,
      )
    } finally {
      await electronApp.close()
    }
  })

  test('does not let parent resize overlap or cut into its child space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        spaces: [
          {
            id: 'child-resize-parent',
            name: 'Child Resize Parent',
            directoryPath: testWorkspacePath,
            nodeIds: [],
            rect: { x: 260, y: 200, width: 680, height: 460 },
          },
          {
            id: 'child-resize-child',
            name: 'Child Resize Child',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'child-resize-parent',
            nodeIds: [],
            rect: { x: 640, y: 330, width: 240, height: 180 },
          },
        ],
        activeSpaceId: null,
      })

      await fitWorkspaceView(window)
      const dragHandle = window.locator(
        '[data-testid="workspace-space-drag-child-resize-parent-right"]',
      )
      await expect(dragHandle).toBeVisible()
      const handleRect = await readLocatorClientRect(dragHandle)
      const start = {
        x: handleRect.x + handleRect.width * 0.5,
        y: handleRect.y + handleRect.height * 0.5,
      }

      await dragMouse(window, {
        start,
        end: { x: start.x - 560, y: start.y },
        steps: 14,
      })

      await expect
        .poll(async () => {
          const after = await readSnapshot(window)
          const parent = after.spaces['child-resize-parent']
          const child = after.spaces['child-resize-child']
          if (!parent || !child) {
            return null
          }

          return {
            childInsideParent: contains(parent, child),
            parentRight: parent.x + parent.width,
            childRight: child.x + child.width,
          }
        })
        .toEqual(
          expect.objectContaining({
            childInsideParent: true,
          }),
        )
    } finally {
      await electronApp.close()
    }
  })

  test('moves child spaces when another space collision pushes their parent', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        spaces: [
          {
            id: 'child-push-mover',
            name: 'Child Push Mover',
            directoryPath: testWorkspacePath,
            nodeIds: [],
            rect: { x: 120, y: 240, width: 360, height: 260 },
          },
          {
            id: 'child-push-parent',
            name: 'Child Push Parent',
            directoryPath: testWorkspacePath,
            nodeIds: [],
            rect: { x: 620, y: 240, width: 420, height: 300 },
          },
          {
            id: 'child-push-child',
            name: 'Child Push Child',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'child-push-parent',
            nodeIds: [],
            rect: { x: 700, y: 310, width: 220, height: 160 },
          },
        ],
        activeSpaceId: null,
      })

      await fitWorkspaceView(window)
      const before = await readSnapshot(window)
      const dragHandle = window.locator('[data-testid="workspace-space-drag-child-push-mover-top"]')
      await expect(dragHandle).toBeVisible()
      await dragSpaceTopHandle(window, dragHandle, { x: 520, y: 0 })

      await expect
        .poll(async () => {
          const after = await readSnapshot(window)
          const mover = after.spaces['child-push-mover']
          const parent = after.spaces['child-push-parent']
          const child = after.spaces['child-push-child']
          if (!mover || !parent || !child) {
            return null
          }

          const parentDx = parent.x - before.spaces['child-push-parent'].x
          const parentDy = parent.y - before.spaces['child-push-parent'].y

          return {
            parentWasPushed: Math.abs(parentDx) + Math.abs(parentDy) > 0,
            childDx: child.x - before.spaces['child-push-child'].x,
            childDy: child.y - before.spaces['child-push-child'].y,
            parentDx,
            parentDy,
            childInsideParent: contains(parent, child, 12),
            moverClearOfParent: !overlaps(mover, parent),
          }
        })
        .toEqual(
          expect.objectContaining({
            parentWasPushed: true,
            childInsideParent: true,
            moverClearOfParent: true,
          }),
        )

      const after = await readSnapshot(window)
      const parentDx = after.spaces['child-push-parent'].x - before.spaces['child-push-parent'].x
      const parentDy = after.spaces['child-push-parent'].y - before.spaces['child-push-parent'].y
      expect(after.spaces['child-push-child'].x - before.spaces['child-push-child'].x).toBe(
        parentDx,
      )
      expect(after.spaces['child-push-child'].y - before.spaces['child-push-child'].y).toBe(
        parentDy,
      )
    } finally {
      await electronApp.close()
    }
  })

  test('pushes same-parent child spaces and nodes when dragging a child space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'child-local-parent-node',
            title: 'terminal-child-local-parent-node',
            position: { x: 570, y: 420 },
            width: 60,
            height: 80,
          },
        ],
        {
          spaces: [
            {
              id: 'child-local-parent',
              name: 'Child Local Parent',
              directoryPath: testWorkspacePath,
              nodeIds: ['child-local-parent-node'],
              rect: { x: 260, y: 200, width: 780, height: 480 },
            },
            {
              id: 'child-local-moving',
              name: 'Child Local Moving',
              directoryPath: testWorkspacePath,
              parentSpaceId: 'child-local-parent',
              nodeIds: [],
              rect: { x: 340, y: 300, width: 220, height: 160 },
            },
            {
              id: 'child-local-sibling',
              name: 'Child Local Sibling',
              directoryPath: testWorkspacePath,
              parentSpaceId: 'child-local-parent',
              nodeIds: [],
              rect: { x: 650, y: 300, width: 220, height: 160 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await fitWorkspaceView(window)
      const before = await readSnapshot(window)
      const dragHandle = window.locator(
        '[data-testid="workspace-space-drag-child-local-moving-top"]',
      )
      await expect(dragHandle).toBeVisible()
      await dragSpaceTopHandle(window, dragHandle, { x: 220, y: 0 }, 14)

      await expect
        .poll(async () => {
          const after = await readSnapshot(window)
          const parent = after.spaces['child-local-parent']
          const moving = after.spaces['child-local-moving']
          const sibling = after.spaces['child-local-sibling']
          const parentNode = after.nodes['child-local-parent-node']
          if (!parent || !moving || !sibling || !parentNode) {
            return null
          }

          return {
            movingChildMoved: moving.x - before.spaces['child-local-moving'].x > 100,
            siblingOrNodeMoved:
              sibling.x !== before.spaces['child-local-sibling'].x ||
              sibling.y !== before.spaces['child-local-sibling'].y ||
              parentNode.x !== before.nodes['child-local-parent-node'].x ||
              parentNode.y !== before.nodes['child-local-parent-node'].y,
            movingInsideParent: contains(parent, moving, 12),
            movingClearOfSibling: !overlaps(moving, sibling),
            movingClearOfParentNode: !overlaps(moving, parentNode),
            siblingClearOfParentNode: !overlaps(sibling, parentNode),
          }
        })
        .toEqual({
          movingChildMoved: true,
          siblingOrNodeMoved: true,
          movingInsideParent: true,
          movingClearOfSibling: true,
          movingClearOfParentNode: true,
          siblingClearOfParentNode: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
