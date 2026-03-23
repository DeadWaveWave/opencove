import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Nodes vs Spaces (Policy)', () => {
  test('prevents creating a root note overlapping a space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const spaceRect = { x: 340, y: 260, width: 620, height: 420 }

      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-policy-anchor',
            title: 'terminal-space-policy-anchor',
            position: { x: 420, y: 340 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-policy-create-root',
              name: 'Policy',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-policy-anchor'],
              rect: spaceRect,
            },
          ],
          activeSpaceId: null,
        },
      )

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()
      const spaceBox = await spaceRegion.boundingBox()
      if (!spaceBox) {
        throw new Error('space region bounding box unavailable')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('pane bounding box unavailable')
      }

      await pane.dblclick({
        position: {
          x: spaceBox.x - paneBox.x - 80,
          y: spaceBox.y - paneBox.y + spaceBox.height / 2,
        },
      })

      await expect(window.locator('.note-node')).toHaveCount(1)

      await expect
        .poll(
          async () => {
            return await window.evaluate(async key => {
              void key

              const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
              if (!raw) {
                return null
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  nodes?: Array<{
                    id?: string
                    kind?: string
                    note?: unknown
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
              const space = workspace?.spaces?.find(item => item.id === 'space-policy-create-root')
              const node =
                workspace?.nodes?.find(item => item.kind === 'note') ??
                workspace?.nodes?.find(
                  item => typeof item.note === 'object' && item.note !== null,
                ) ??
                null

              if (
                !space?.rect ||
                typeof space.rect.x !== 'number' ||
                typeof space.rect.y !== 'number' ||
                typeof space.rect.width !== 'number' ||
                typeof space.rect.height !== 'number' ||
                !node?.position ||
                typeof node.position.x !== 'number' ||
                typeof node.position.y !== 'number' ||
                typeof node.width !== 'number' ||
                typeof node.height !== 'number'
              ) {
                return null
              }

              const nodeRect = {
                x: node.position.x,
                y: node.position.y,
                width: node.width,
                height: node.height,
              }
              const persistedSpaceRect = {
                x: space.rect.x,
                y: space.rect.y,
                width: space.rect.width,
                height: space.rect.height,
              }

              const overlap = !(
                nodeRect.x + nodeRect.width <= persistedSpaceRect.x ||
                nodeRect.x >= persistedSpaceRect.x + persistedSpaceRect.width ||
                nodeRect.y + nodeRect.height <= persistedSpaceRect.y ||
                nodeRect.y >= persistedSpaceRect.y + persistedSpaceRect.height
              )

              return { overlap }
            }, storageKey)
          },
          { timeout: 10_000 },
        )
        .toEqual({ overlap: false })
    } finally {
      await electronApp.close()
    }
  })

  test('does not expand a space unexpectedly when creating a note inside it', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const seededRect = { x: 120, y: 200, width: 620, height: 420 }

      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-policy-inside-anchor',
            title: 'terminal-space-policy-inside-anchor',
            position: { x: 380, y: 224 },
            width: 320,
            height: 220,
          },
        ],
        {
          spaces: [
            {
              id: 'space-policy-create-inside',
              name: 'Policy Inside',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-policy-inside-anchor'],
              rect: seededRect,
            },
          ],
          activeSpaceId: null,
        },
      )

      const spaceRegion = window.locator('.workspace-space-region').first()
      await expect(spaceRegion).toBeVisible()
      const spaceBox = await spaceRegion.boundingBox()
      if (!spaceBox) {
        throw new Error('space region bounding box unavailable')
      }

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('pane bounding box unavailable')
      }

      const clickPosition = {
        x: spaceBox.x - paneBox.x + 32,
        y: spaceBox.y - paneBox.y + spaceBox.height - 32,
      }

      await pane.click({
        button: 'right',
        position: clickPosition,
      })

      const createNote = window.locator('[data-testid="workspace-context-new-note"]')
      await expect(createNote).toBeVisible()
      await createNote.click()

      await expect(window.locator('.note-node')).toHaveCount(1)

      await expect
        .poll(
          async () => {
            return await window.evaluate(
              async input => {
                const { key, expectedRect } = input
                void key

                const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
                if (!raw) {
                  return null
                }

                const parsed = JSON.parse(raw) as {
                  workspaces?: Array<{
                    nodes?: Array<{
                      id?: string
                      kind?: string
                      note?: unknown
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
                const space = workspace?.spaces?.find(
                  item => item.id === 'space-policy-create-inside',
                )
                const node =
                  workspace?.nodes?.find(item => item.kind === 'note') ??
                  workspace?.nodes?.find(
                    item => typeof item.note === 'object' && item.note !== null,
                  ) ??
                  null
                const anchor = workspace?.nodes?.find(
                  item => item.id === 'space-policy-inside-anchor',
                )

                if (
                  !space?.rect ||
                  !node?.id ||
                  !node?.position ||
                  typeof node.position.x !== 'number' ||
                  typeof node.position.y !== 'number' ||
                  typeof node.width !== 'number' ||
                  typeof node.height !== 'number' ||
                  !anchor?.position ||
                  typeof anchor.position.x !== 'number' ||
                  typeof anchor.position.y !== 'number' ||
                  typeof anchor.width !== 'number' ||
                  typeof anchor.height !== 'number' ||
                  typeof space.rect.x !== 'number' ||
                  typeof space.rect.y !== 'number' ||
                  typeof space.rect.width !== 'number' ||
                  typeof space.rect.height !== 'number' ||
                  !Array.isArray(space.nodeIds)
                ) {
                  return null
                }

                const rect = space.rect
                const noteRect = {
                  left: node.position.x,
                  top: node.position.y,
                  right: node.position.x + node.width,
                  bottom: node.position.y + node.height,
                }
                const anchorRect = {
                  left: anchor.position.x,
                  top: anchor.position.y,
                  right: anchor.position.x + anchor.width,
                  bottom: anchor.position.y + anchor.height,
                }
                const spaceRight = rect.x + rect.width
                const spaceBottom = rect.y + rect.height

                const noteInside =
                  noteRect.left >= rect.x &&
                  noteRect.top >= rect.y &&
                  noteRect.right <= spaceRight &&
                  noteRect.bottom <= spaceBottom

                const noOverlap =
                  noteRect.right <= anchorRect.left ||
                  noteRect.left >= anchorRect.right ||
                  noteRect.bottom <= anchorRect.top ||
                  noteRect.top >= anchorRect.bottom

                const boundedGrowth =
                  rect.width >= expectedRect.width &&
                  rect.height >= expectedRect.height &&
                  rect.width <= expectedRect.width + 420 &&
                  rect.height <= expectedRect.height + 280

                return {
                  nodeAssigned: space.nodeIds.includes(node.id),
                  noteInside,
                  noOverlap,
                  boundedGrowth,
                }
              },
              { key: storageKey, expectedRect: seededRect },
            )
          },
          { timeout: 10_000 },
        )
        .toEqual({
          nodeAssigned: true,
          noteInside: true,
          noOverlap: true,
          boundedGrowth: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
