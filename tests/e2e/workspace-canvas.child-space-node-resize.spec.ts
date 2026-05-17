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
  fitWorkspaceView,
  readChildSpaceSnapshot,
} from './workspace-canvas.child-space.helpers'

test.describe('Workspace Canvas - Child Space Node Resize', () => {
  test('keeps child space containment when resizing nodes across child and parent spaces', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'child-resize-node',
            title: 'terminal-child-resize-node',
            position: { x: 420, y: 320 },
            width: 180,
            height: 120,
          },
          {
            id: 'parent-resize-node',
            title: 'terminal-parent-resize-node',
            position: { x: 360, y: 760 },
            width: 180,
            height: 120,
          },
        ],
        {
          spaces: [
            {
              id: 'node-resize-parent',
              name: 'Node Resize Parent',
              directoryPath: testWorkspacePath,
              nodeIds: ['parent-resize-node'],
              rect: { x: 300, y: 240, width: 420, height: 700 },
            },
            {
              id: 'node-resize-child',
              name: 'Node Resize Child',
              directoryPath: testWorkspacePath,
              parentSpaceId: 'node-resize-parent',
              nodeIds: ['child-resize-node'],
              rect: { x: 380, y: 290, width: 250, height: 180 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await fitWorkspaceView(window)

      const childNode = window.locator('.terminal-node', { hasText: 'terminal-child-resize-node' })
      await expect(childNode).toBeVisible()
      const childRightResizer = childNode.locator('[data-testid="terminal-resizer-right"]')
      const childResizerRect = await readLocatorClientRect(childRightResizer)
      await dragMouse(window, {
        start: {
          x: childResizerRect.x + childResizerRect.width / 2,
          y: childResizerRect.y + childResizerRect.height / 2,
        },
        end: {
          x: childResizerRect.x + childResizerRect.width / 2 + 360,
          y: childResizerRect.y + childResizerRect.height / 2,
        },
        steps: 14,
      })

      await expect
        .poll(async () => {
          const after = await readChildSpaceSnapshot(window)
          const parent = after.spaces['node-resize-parent']
          const child = after.spaces['node-resize-child']
          const resizedNode = after.nodes['child-resize-node']
          if (!parent || !child || !resizedNode) {
            return null
          }

          return {
            childExpanded: child.width > 250,
            parentExpanded: parent.width > 420,
            childInsideParent: contains(parent, child),
            nodeInsideChild: contains(child, resizedNode),
          }
        })
        .toEqual({
          childExpanded: true,
          parentExpanded: true,
          childInsideParent: true,
          nodeInsideChild: true,
        })

      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'parent-resize-node',
            title: 'terminal-parent-resize-node',
            position: { x: 360, y: 760 },
            width: 180,
            height: 120,
          },
        ],
        {
          spaces: [
            {
              id: 'node-resize-parent',
              name: 'Node Resize Parent',
              directoryPath: testWorkspacePath,
              nodeIds: ['parent-resize-node'],
              rect: { x: 300, y: 240, width: 420, height: 700 },
            },
            {
              id: 'node-resize-child',
              name: 'Node Resize Child',
              directoryPath: testWorkspacePath,
              parentSpaceId: 'node-resize-parent',
              nodeIds: [],
              rect: { x: 380, y: 290, width: 250, height: 180 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await fitWorkspaceView(window)
      const beforeParentResize = await readChildSpaceSnapshot(window)
      const parentNode = window.locator('.terminal-node', {
        hasText: 'terminal-parent-resize-node',
      })
      await expect(parentNode).toBeVisible()
      const parentRightResizer = parentNode.locator('[data-testid="terminal-resizer-right"]')
      const parentResizerRect = await readLocatorClientRect(parentRightResizer)
      await dragMouse(window, {
        start: {
          x: parentResizerRect.x + parentResizerRect.width / 2,
          y: parentResizerRect.y + parentResizerRect.height / 2,
        },
        end: {
          x: parentResizerRect.x + parentResizerRect.width / 2 + 360,
          y: parentResizerRect.y + parentResizerRect.height / 2,
        },
        steps: 14,
      })

      await expect
        .poll(async () => {
          const after = await readChildSpaceSnapshot(window)
          const parent = after.spaces['node-resize-parent']
          const child = after.spaces['node-resize-child']
          const parentNodeAfter = after.nodes['parent-resize-node']
          const previousChild = beforeParentResize.spaces['node-resize-child']
          const previousParent = beforeParentResize.spaces['node-resize-parent']
          if (!parent || !child || !parentNodeAfter || !previousChild || !previousParent) {
            return null
          }

          return {
            parentExpanded: parent.width > previousParent.width,
            childStable:
              child.x === previousChild.x &&
              child.y === previousChild.y &&
              child.width === previousChild.width &&
              child.height === previousChild.height,
            childInsideParent: contains(parent, child),
            parentNodeInsideParent: contains(parent, parentNodeAfter),
          }
        })
        .toEqual({
          parentExpanded: true,
          childStable: true,
          childInsideParent: true,
          parentNodeInsideParent: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
