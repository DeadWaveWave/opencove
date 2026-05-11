import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  clickHeaderDragSurface,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const commandCenterModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const findModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function readWorkspaceSnapshot(window: {
  evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>
}) {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    return JSON.parse(raw) as {
      workspaces?: Array<{
        spaces?: Array<{
          id?: string
          name?: string
          parentSpaceId?: string | null
          nodeIds?: string[]
          rect?: { x?: number; y?: number; width?: number; height?: number } | null
        }>
      }>
    }
  })
}

test.describe('Workspace Canvas - Child Space', () => {
  test('renders child spaces only inside the canvas scope', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        spaces: [
          {
            id: 'child-filter-parent',
            name: 'Parent Scope',
            directoryPath: testWorkspacePath,
            nodeIds: [],
            rect: { x: 260, y: 180, width: 680, height: 460 },
          },
          {
            id: 'child-filter-child',
            name: 'Child Scope Hidden From Nav',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'child-filter-parent',
            nodeIds: [],
            rect: { x: 330, y: 260, width: 360, height: 240 },
          },
        ],
        activeSpaceId: 'child-filter-parent',
      })

      await expect(
        window.locator('[data-testid="workspace-space-label-child-filter-child"]'),
      ).toBeVisible()
      await expect(
        window.locator(
          '.workspace-space-region--child[data-parent-space-id="child-filter-parent"]',
        ),
      ).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-space-switch-child-filter-parent"]'),
      ).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-space-switch-child-filter-child"]'),
      ).toHaveCount(0)

      await window.keyboard.press(`${commandCenterModifier}+P`)
      const commandCenterInput = window.locator('[data-testid="command-center-input"]')
      await expect(commandCenterInput).toBeFocused()
      await commandCenterInput.fill('Child Scope Hidden From Nav')
      await expect(
        window.locator('[data-testid="command-center-item-space:child-filter-child"]'),
      ).toHaveCount(0)
      await window.keyboard.press('Escape')

      await window.keyboard.press(`${findModifier}+F`)
      const searchInput = window.locator('[data-testid="workspace-search-input"]')
      await expect(searchInput).toBeFocused()
      await searchInput.fill('Child Scope Hidden From Nav')
      await expect(
        window.locator('[data-testid="workspace-search-item-space:child-filter-child"]'),
      ).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('creates a child space from selected nodes and moves ownership atomically', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'child-create-node',
            title: 'terminal-child-create',
            position: { x: 360, y: 280 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'child-create-parent',
              name: 'Parent Create Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['child-create-node'],
              rect: { x: 300, y: 220, width: 620, height: 420 },
            },
          ],
          activeSpaceId: 'child-create-parent',
        },
      )

      const terminalNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-child-create' })
      await expect(terminalNode).toBeVisible()
      await clickHeaderDragSurface(terminalNode.locator('.terminal-node__header'))
      await terminalNode.click({ button: 'right' })
      await expect(
        window.locator('[data-testid="workspace-selection-create-child-space"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-selection-create-child-space"]').click()

      await expect(window.locator('.workspace-space-region--child')).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-space-switch-child-create-parent"]'),
      ).toBeVisible()

      await expect
        .poll(async () => {
          const snapshot = await readWorkspaceSnapshot(window)
          const spaces = snapshot?.workspaces?.[0]?.spaces ?? []
          const parent = spaces.find(space => space.id === 'child-create-parent') ?? null
          const child = spaces.find(space => space.parentSpaceId === 'child-create-parent') ?? null
          return {
            parentNodeIds: parent?.nodeIds ?? [],
            childNodeIds: child?.nodeIds ?? [],
            hasChildSwitcher: await window
              .locator(`[data-testid="workspace-space-switch-${child?.id ?? 'missing'}"]`)
              .count(),
          }
        })
        .toEqual({
          parentNodeIds: [],
          childNodeIds: ['child-create-node'],
          hasChildSwitcher: 0,
        })
    } finally {
      await electronApp.close()
    }
  })

  test('clamps child space dragging inside its parent', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [], {
        spaces: [
          {
            id: 'child-drag-parent',
            name: 'Parent Drag Scope',
            directoryPath: testWorkspacePath,
            nodeIds: [],
            rect: { x: 300, y: 220, width: 620, height: 420 },
          },
          {
            id: 'child-drag-child',
            name: 'Child Drag Scope',
            directoryPath: testWorkspacePath,
            parentSpaceId: 'child-drag-parent',
            nodeIds: [],
            rect: { x: 380, y: 300, width: 260, height: 180 },
          },
        ],
        activeSpaceId: 'child-drag-parent',
      })

      const dragHandle = window.locator('[data-testid="workspace-space-drag-child-drag-child-top"]')
      const handleRect = await readLocatorClientRect(dragHandle)
      const start = {
        x: handleRect.x + handleRect.width * 0.5,
        y: handleRect.y + handleRect.height * 0.5,
      }

      await dragMouse(window, {
        start,
        end: { x: start.x - 600, y: start.y - 420 },
        steps: 16,
      })

      await expect
        .poll(async () => {
          const snapshot = await readWorkspaceSnapshot(window)
          const spaces = snapshot?.workspaces?.[0]?.spaces ?? []
          const parent = spaces.find(space => space.id === 'child-drag-parent')?.rect ?? null
          const child = spaces.find(space => space.id === 'child-drag-child')?.rect ?? null
          if (!parent || !child) {
            return null
          }

          return {
            insideLeft:
              typeof child.x === 'number' &&
              typeof parent.x === 'number' &&
              child.x >= parent.x + 12,
            insideTop:
              typeof child.y === 'number' &&
              typeof parent.y === 'number' &&
              child.y >= parent.y + 12,
          }
        })
        .toEqual({
          insideLeft: true,
          insideTop: true,
        })
    } finally {
      await electronApp.close()
    }
  })
})
