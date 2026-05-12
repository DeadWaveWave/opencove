import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragHeaderDragSurfaceTo,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Snapshot {
  nodes: Record<string, Rect>
  spaces: Record<string, Rect & { nodeIds: string[] }>
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x + a.width > b.x && a.x < b.x + b.width && a.y + a.height > b.y && a.y < b.y + b.height
}

function contains(container: Rect, child: Rect): boolean {
  return (
    child.x >= container.x &&
    child.y >= container.y &&
    child.x + child.width <= container.x + container.width &&
    child.y + child.height <= container.y + container.height
  )
}

async function readSnapshot(window: Page): Promise<Snapshot> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return { nodes: {}, spaces: {} }
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
    const nodes: Snapshot['nodes'] = {}
    const spaces: Snapshot['spaces'] = {}

    for (const node of workspace?.nodes ?? []) {
      if (
        !node.id ||
        !node.position ||
        typeof node.position.x !== 'number' ||
        typeof node.position.y !== 'number' ||
        typeof node.width !== 'number' ||
        typeof node.height !== 'number'
      ) {
        continue
      }

      nodes[node.id] = {
        x: node.position.x,
        y: node.position.y,
        width: node.width,
        height: node.height,
      }
    }

    for (const space of workspace?.spaces ?? []) {
      if (
        !space.id ||
        !space.rect ||
        typeof space.rect.x !== 'number' ||
        typeof space.rect.y !== 'number' ||
        typeof space.rect.width !== 'number' ||
        typeof space.rect.height !== 'number'
      ) {
        continue
      }

      spaces[space.id] = {
        x: space.rect.x,
        y: space.rect.y,
        width: space.rect.width,
        height: space.rect.height,
        nodeIds: Array.isArray(space.nodeIds) ? space.nodeIds : [],
      }
    }

    return { nodes, spaces }
  })
}

async function fitWorkspaceView(window: Page): Promise<void> {
  const fitView = window.locator('.react-flow__controls-fitview')
  await expect(fitView).toBeVisible()
  await fitView.click()
  await window.waitForTimeout(100)
}

async function flowPointToPanePosition(
  window: Page,
  flowPoint: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const pane = window.locator('.workspace-canvas .react-flow__pane')
  const paneBox = await readLocatorClientRect(pane)
  const viewport = await readCanvasViewport(window)

  return {
    x: Math.max(40, Math.min(paneBox.width - 40, viewport.x + flowPoint.x * viewport.zoom)),
    y: Math.max(40, Math.min(paneBox.height - 40, viewport.y + flowPoint.y * viewport.zoom)),
  }
}

test.describe('Workspace Canvas - Child Space Node Drop', () => {
  test('blocks node overlap until the drag pointer enters the child space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'child-drop-node',
            title: 'note-child-drop',
            position: { x: 300, y: 300 },
            width: 120,
            height: 100,
            kind: 'note',
            task: { text: 'drag into child space' },
          },
        ],
        {
          spaces: [
            {
              id: 'child-drop-parent',
              name: 'Child Drop Parent',
              directoryPath: testWorkspacePath,
              nodeIds: ['child-drop-node'],
              rect: { x: 220, y: 180, width: 700, height: 430 },
            },
            {
              id: 'child-drop-child',
              name: 'Child Drop Child',
              directoryPath: testWorkspacePath,
              parentSpaceId: 'child-drop-parent',
              nodeIds: [],
              rect: { x: 500, y: 280, width: 260, height: 190 },
            },
          ],
          activeSpaceId: null,
        },
      )

      await fitWorkspaceView(window)
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      const dragNode = window.locator('.note-node').filter({ hasText: 'note-child-drop' }).first()
      await expect(dragNode).toBeVisible()

      await dragHeaderDragSurfaceTo(window, dragNode.locator('.note-node__header'), pane, {
        sourcePosition: { x: 60, y: 16 },
        targetPosition: await flowPointToPanePosition(window, { x: 492, y: 360 }),
        steps: 16,
      })

      await expect
        .poll(async () => {
          const snapshot = await readSnapshot(window)
          const node = snapshot.nodes['child-drop-node']
          const parent = snapshot.spaces['child-drop-parent']
          const child = snapshot.spaces['child-drop-child']
          if (!node || !parent || !child) {
            return null
          }

          return {
            parentOwnsNode: parent.nodeIds.includes('child-drop-node'),
            childOwnsNode: child.nodeIds.includes('child-drop-node'),
            nodeOverlapsChild: overlaps(node, child),
          }
        })
        .toEqual({
          parentOwnsNode: true,
          childOwnsNode: false,
          nodeOverlapsChild: false,
        })

      await dragHeaderDragSurfaceTo(window, dragNode.locator('.note-node__header'), pane, {
        sourcePosition: { x: 60, y: 16 },
        targetPosition: await flowPointToPanePosition(window, { x: 630, y: 370 }),
        steps: 16,
      })

      await expect
        .poll(async () => {
          const snapshot = await readSnapshot(window)
          const node = snapshot.nodes['child-drop-node']
          const child = snapshot.spaces['child-drop-child']
          if (!node || !child) {
            return null
          }

          return {
            childOwnsNode: child.nodeIds.includes('child-drop-node'),
            nodeInsideChild: contains(child, node),
          }
        })
        .toEqual({
          childOwnsNode: true,
          nodeInsideChild: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
