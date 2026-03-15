import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Push-away)', () => {
  test('keeps blocking root windows clear when moving a space over them', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-move-owned',
            title: 'terminal-space-move-owned',
            position: { x: 420, y: 340 },
            width: 460,
            height: 300,
          },
          {
            id: 'root-blocking',
            title: 'terminal-root-blocking',
            position: { x: 980, y: 340 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-move',
              name: 'Move Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-move-owned'],
              rect: { x: 340, y: 280, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const terminals = window.locator('.terminal-node')
      await expect(terminals).toHaveCount(2)

      const dragHandle = window.locator('[data-testid="workspace-space-drag-space-move-top"]')
      await expect(dragHandle).toBeVisible()

      const handleBox = await dragHandle.boundingBox()
      if (!handleBox) {
        throw new Error('space drag handle bounding box unavailable')
      }

      const startX = handleBox.x + handleBox.width * 0.9
      const startY = handleBox.y + handleBox.height * 0.5
      const dragDx = 820
      const dragDy = 0

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: startX + dragDx, y: startY + dragDy },
        steps: 14,
      })

      await expect
        .poll(async () => {
          return await window.evaluate(async key => {
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
            const root = workspace?.nodes?.find(node => node.id === 'root-blocking')
            const spaceRect = workspace?.spaces?.find(space => space.id === 'space-move')?.rect

            if (
              !root?.position ||
              typeof root.position.x !== 'number' ||
              typeof root.width !== 'number' ||
              !spaceRect ||
              typeof spaceRect.x !== 'number' ||
              typeof spaceRect.width !== 'number'
            ) {
              return false
            }

            const rootLeft = root.position.x
            const rootRight = root.position.x + root.width
            const spaceRight = spaceRect.x + spaceRect.width

            return rootLeft >= spaceRight && rootRight > rootLeft
          }, storageKey)
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps blocking windows clear when resizing a space outward', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-resize-owned',
            title: 'terminal-space-resize-owned',
            position: { x: 80, y: 340 },
            width: 460,
            height: 300,
          },
          {
            id: 'root-blocking-resize',
            title: 'terminal-root-blocking-resize',
            position: { x: 640, y: 340 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-resize',
              name: 'Resize Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-resize-owned'],
              rect: { x: 0, y: 280, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const terminals = window.locator('.terminal-node')
      await expect(terminals).toHaveCount(2)

      const dragHandle = window.locator('[data-testid="workspace-space-drag-space-resize-right"]')
      await expect(dragHandle).toBeVisible()

      const handleBox = await dragHandle.boundingBox()
      if (!handleBox) {
        throw new Error('space resize handle bounding box unavailable')
      }

      const startX = handleBox.x + handleBox.width * 0.5
      const startY = handleBox.y + handleBox.height * 0.5

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: startX + 220, y: startY },
        steps: 12,
      })

      await expect
        .poll(async () => {
          return await window.evaluate(async key => {
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
            const owned = workspace?.nodes?.find(node => node.id === 'space-resize-owned')
            const root = workspace?.nodes?.find(node => node.id === 'root-blocking-resize')
            const spaceRect = workspace?.spaces?.find(space => space.id === 'space-resize')?.rect

            if (
              !owned?.position ||
              typeof owned.position.x !== 'number' ||
              !root?.position ||
              typeof root.position.x !== 'number' ||
              typeof root.width !== 'number' ||
              !spaceRect ||
              typeof spaceRect.x !== 'number' ||
              typeof spaceRect.width !== 'number'
            ) {
              return false
            }

            const ownedX = owned.position.x
            const rootLeft = root.position.x
            const rootRight = root.position.x + root.width
            const spaceRight = spaceRect.x + spaceRect.width

            return ownedX === 80 && rootLeft >= spaceRight && rootRight > rootLeft
          }, storageKey)
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('does not allow resizing a space inward past its owned nodes', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-shrink-owned',
            title: 'terminal-space-shrink-owned',
            position: { x: 80, y: 340 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-shrink',
              name: 'Shrink Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-shrink-owned'],
              rect: { x: 0, y: 280, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const dragHandle = window.locator('[data-testid="workspace-space-drag-space-shrink-right"]')
      await expect(dragHandle).toBeVisible()

      const handleBox = await dragHandle.boundingBox()
      if (!handleBox) {
        throw new Error('space resize handle bounding box unavailable')
      }

      const startX = handleBox.x + handleBox.width * 0.5
      const startY = handleBox.y + handleBox.height * 0.5

      await dragMouse(window, {
        start: { x: startX, y: startY },
        end: { x: startX - 480, y: startY },
        steps: 12,
      })

      await expect
        .poll(async () => {
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
            const node = workspace?.nodes?.find(item => item.id === 'space-shrink-owned')
            const rect = workspace?.spaces?.find(item => item.id === 'space-shrink')?.rect

            if (
              !node?.position ||
              typeof node.position.x !== 'number' ||
              typeof node.width !== 'number' ||
              !rect ||
              typeof rect.x !== 'number' ||
              typeof rect.width !== 'number'
            ) {
              return null
            }

            const nodeRight = node.position.x + node.width
            const spaceRight = rect.x + rect.width
            return {
              spaceWidth: rect.width,
              spaceRight,
              nodeRight,
            }
          }, storageKey)
        })
        .toEqual(
          expect.objectContaining({
            spaceWidth: expect.any(Number),
            spaceRight: expect.any(Number),
            nodeRight: expect.any(Number),
          }),
        )

      await expect
        .poll(async () => {
          return await window.evaluate(async key => {
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
            const node = workspace?.nodes?.find(item => item.id === 'space-shrink-owned')
            const rect = workspace?.spaces?.find(item => item.id === 'space-shrink')?.rect

            if (
              !node?.position ||
              typeof node.position.x !== 'number' ||
              typeof node.width !== 'number' ||
              !rect ||
              typeof rect.x !== 'number' ||
              typeof rect.width !== 'number'
            ) {
              return false
            }

            const nodeRight = node.position.x + node.width
            const spaceRight = rect.x + rect.width
            return spaceRight >= nodeRight
          }, storageKey)
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })
})
