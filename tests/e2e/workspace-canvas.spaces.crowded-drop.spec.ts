import { expect, test } from '@playwright/test'
import {
  beginDragMouse,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Crowded Drop)', () => {
  test('previews crowded Space expansion before committing it on release', async () => {
    const { electronApp, window } = await launchApp()
    let releaseHeldDrag: (() => Promise<void>) | null = null

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-full-static-node',
            title: 'note-static',
            position: { x: 140, y: 140 },
            width: 460,
            height: 300,
            kind: 'note',
            task: { text: 'static note' },
          },
          {
            id: 'space-full-drag-node',
            title: 'note-drag',
            position: { x: 140, y: 560 },
            width: 460,
            height: 300,
            kind: 'note',
            task: { text: 'drag note' },
          },
        ],
        {
          settings: {
            canvasInputMode: 'mouse',
          },
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
      const paneBox = await readLocatorClientRect(pane)
      const viewport = await readCanvasViewport(window)

      const draggedNode = window.locator('.note-node').filter({ hasText: 'drag note' }).first()
      await expect(draggedNode).toBeVisible()
      const dragSurface = draggedNode.getByTestId('note-node-header-drag-surface')
      const dragSurfaceBox = await readLocatorClientRect(dragSurface)
      const spaceRegion = window.getByTestId('workspace-space-drag-space-full-right').locator('..')
      const initialSpaceClientRect = await readLocatorClientRect(spaceRegion)

      const clamp = (value: number, min: number, max: number): number =>
        Math.max(min, Math.min(max, value))

      const dropFlowPoint = {
        x: 620,
        y: 460,
      }

      const target = {
        x: paneBox.x + clamp(viewport.x + dropFlowPoint.x * viewport.zoom, 40, paneBox.width - 40),
        y: paneBox.y + clamp(viewport.y + dropFlowPoint.y * viewport.zoom, 40, paneBox.height - 40),
      }
      const drag = await beginDragMouse(window, {
        start: { x: dragSurfaceBox.x + 80, y: dragSurfaceBox.y + 16 },
        initialTarget: target,
      })
      releaseHeldDrag = drag.release
      await drag.moveTo(target, { steps: 16, settleAfterMoveMs: 180 })

      await expect
        .poll(async () => {
          const previewRect = await readLocatorClientRect(spaceRegion)
          return {
            expanded:
              previewRect.width > initialSpaceClientRect.width + 2 ||
              previewRect.height > initialSpaceClientRect.height + 2,
            initial: initialSpaceClientRect,
            preview: previewRect,
          }
        })
        .toMatchObject({ expanded: true })
      const previewSpaceClientRect = await readLocatorClientRect(spaceRegion)

      // The frame is derived UI while the pointer is held; durable ownership,
      // geometry, and node position must remain at their drag baseline.
      await window.waitForTimeout(180)
      const durableDuringPreview = await window.evaluate(async () => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        if (!raw) {
          return null
        }

        const parsed = JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{ id?: string; position?: { x?: number; y?: number } }>
            spaces?: Array<{
              id?: string
              nodeIds?: string[]
              rect?: { x?: number; y?: number; width?: number; height?: number } | null
            }>
          }>
        }
        const workspace = parsed.workspaces?.[0]
        const space = workspace?.spaces?.find(item => item.id === 'space-full')
        const dragNode = workspace?.nodes?.find(item => item.id === 'space-full-drag-node')

        return {
          nodeIds: space?.nodeIds ?? null,
          rect: space?.rect ?? null,
          dragPosition: dragNode?.position ?? null,
        }
      })
      expect(durableDuringPreview).toEqual({
        nodeIds: ['space-full-static-node'],
        rect: { x: 120, y: 120, width: 520, height: 360 },
        dragPosition: { x: 140, y: 560 },
      })

      await drag.release()
      releaseHeldDrag = null

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

      await expect
        .poll(async () => {
          const committedRect = await readLocatorClientRect(spaceRegion)
          return Math.max(
            Math.abs(committedRect.x - previewSpaceClientRect.x),
            Math.abs(committedRect.y - previewSpaceClientRect.y),
            Math.abs(committedRect.width - previewSpaceClientRect.width),
            Math.abs(committedRect.height - previewSpaceClientRect.height),
          )
        })
        // Release recomputes from durable state and may normalize legacy padding.
        .toBeLessThanOrEqual(8)
    } finally {
      await releaseHeldDrag?.().catch(() => undefined)
      await electronApp.close()
    }
  })
})
