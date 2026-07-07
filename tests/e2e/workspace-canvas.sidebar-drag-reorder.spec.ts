import { expect, test } from '@playwright/test'
import {
  dragMouse,
  launchApp,
  readLocatorClientRect,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'

function createAgentNode(id: string, title: string, sidebarSortOrder: number) {
  return {
    id,
    title: `codex · ${title}`,
    position: { x: 120 + sidebarSortOrder * 40, y: 120 + sidebarSortOrder * 40 },
    width: 520,
    height: 320,
    kind: 'agent' as const,
    status: 'running' as const,
    startedAt: `2026-02-09T0${sidebarSortOrder + 1}:00:00.000Z`,
    endedAt: null,
    exitCode: null,
    lastError: null,
    sidebarSortOrder,
    agent: {
      provider: 'codex' as const,
      prompt: title,
      model: 'gpt-5.2-codex',
      effectiveModel: 'gpt-5.2-codex',
      launchMode: 'new' as const,
      resumeSessionId: null,
      executionDirectory: testWorkspacePath,
      expectedDirectory: testWorkspacePath,
      directoryMode: 'workspace' as const,
      customDirectory: null,
      shouldCreateDirectory: false,
    },
  }
}

test.describe('Workspace Canvas - Sidebar Drag Reorder', () => {
  test('changes project icon from the context menu and persists it', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-icon-a',
        workspaces: [
          {
            id: 'workspace-icon-a',
            name: 'Icon Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const projectItem = window.locator('[data-testid="workspace-item-workspace-icon-a"]')
      await expect(projectItem.locator('.workspace-item__folder-icon')).toHaveAttribute(
        'data-cove-project-icon-id',
        'default',
      )

      await projectItem.click({ button: 'right' })
      await window.locator('[data-testid="workspace-project-context-menu-icon-code"]').click()

      await expect(projectItem.locator('.workspace-item__folder-icon')).toHaveAttribute(
        'data-cove-project-icon-id',
        'code',
      )
      await expect
        .poll(
          async () => {
            const raw = await window.evaluate(async () => {
              return await window.opencoveApi.persistence.readWorkspaceStateRaw()
            })
            const parsed = raw
              ? (JSON.parse(raw) as { workspaces?: Array<{ iconId?: string }> })
              : null
            return parsed?.workspaces?.[0]?.iconId ?? null
          },
          { timeout: 15_000 },
        )
        .toBe('code')
    } finally {
      await electronApp.close()
    }
  })

  test('reorders workspaces by dragging and persists the new order', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-drag-a',
        workspaces: [
          {
            id: 'workspace-drag-a',
            name: 'Project Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-drag-b',
            name: 'Project Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
          {
            id: 'workspace-drag-c',
            name: 'Project Gamma',
            path: `${testWorkspacePath}-c`,
            nodes: [],
          },
        ],
      })

      const workspaceNames = window.locator('.workspace-item__name')
      await expect(workspaceNames).toHaveCount(3)
      await expect(workspaceNames.nth(0)).toHaveText('Project Alpha')
      await expect(workspaceNames.nth(1)).toHaveText('Project Beta')
      await expect(workspaceNames.nth(2)).toHaveText('Project Gamma')

      // Drag "Project Alpha" (first) down to "Project Gamma" (third) position
      const firstItem = window
        .locator('.workspace-item')
        .filter({ hasText: 'Project Alpha' })
        .first()
      const thirdItem = window
        .locator('.workspace-item')
        .filter({ hasText: 'Project Gamma' })
        .first()

      const firstRect = await readLocatorClientRect(firstItem)
      const thirdRect = await readLocatorClientRect(thirdItem)

      await dragMouse(window, {
        start: {
          x: firstRect.x + Math.min(firstRect.width / 2, 40),
          y: firstRect.y + firstRect.height / 2,
        },
        end: {
          x: thirdRect.x + Math.min(thirdRect.width / 2, 40),
          y: thirdRect.y + Math.max(thirdRect.height - 12, thirdRect.height * 0.7),
        },
        steps: 18,
        settleAfterPressMs: 48,
        settleBeforeReleaseMs: 80,
        settleAfterReleaseMs: 80,
      })

      // Verify new order in DOM — Alpha should have moved down
      await expect
        .poll(
          async () => {
            const names = await workspaceNames.allTextContents()
            return names
          },
          { timeout: 8_000 },
        )
        .toEqual(['Project Beta', 'Project Gamma', 'Project Alpha'])

      // Verify persistence — reload and check order is maintained
      await expect
        .poll(
          async () => {
            const raw = await window.evaluate(async () => {
              return await window.opencoveApi.persistence.readWorkspaceStateRaw()
            })
            if (!raw) {
              return null
            }

            const parsed = JSON.parse(raw) as {
              workspaces?: Array<{ name?: string }>
            }

            return (parsed.workspaces ?? []).map(workspace => workspace.name)
          },
          { timeout: 15_000 },
        )
        .toEqual(['Project Beta', 'Project Gamma', 'Project Alpha'])
    } finally {
      await electronApp.close()
    }
  })

  test('reorders root spaces within a project and persists sort order', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-space-drag',
        workspaces: [
          {
            id: 'workspace-space-drag',
            name: 'Space Drag Project',
            path: testWorkspacePath,
            nodes: [],
            spaces: [
              {
                id: 'space-alpha',
                name: 'Space Alpha',
                directoryPath: testWorkspacePath,
                sortOrder: 0,
                labelColor: 'blue',
                nodeIds: [],
              },
              {
                id: 'space-beta',
                name: 'Space Beta',
                directoryPath: testWorkspacePath,
                sortOrder: 1,
                labelColor: 'green',
                nodeIds: [],
              },
              {
                id: 'space-gamma',
                name: 'Space Gamma',
                directoryPath: testWorkspacePath,
                sortOrder: 2,
                labelColor: 'purple',
                nodeIds: [],
              },
            ],
          },
        ],
      })

      const spaceNames = window.locator('.workspace-space-item__name')
      await expect(spaceNames).toHaveCount(3)
      await expect(spaceNames.nth(0)).toHaveText('Space Alpha')

      const firstSpace = window.locator('.workspace-space-item').filter({ hasText: 'Space Alpha' })
      const thirdSpace = window.locator('.workspace-space-item').filter({ hasText: 'Space Gamma' })
      const firstRect = await readLocatorClientRect(firstSpace)
      const thirdRect = await readLocatorClientRect(thirdSpace)

      await dragMouse(window, {
        start: {
          x: firstRect.x + Math.min(firstRect.width / 2, 40),
          y: firstRect.y + firstRect.height / 2,
        },
        end: {
          x: thirdRect.x + Math.min(thirdRect.width / 2, 40),
          y: thirdRect.y + Math.max(thirdRect.height - 8, thirdRect.height * 0.7),
        },
        steps: 18,
        settleAfterPressMs: 48,
        settleBeforeReleaseMs: 80,
        settleAfterReleaseMs: 80,
      })

      await expect
        .poll(async () => await spaceNames.allTextContents(), { timeout: 8_000 })
        .toEqual(['Space Beta', 'Space Gamma', 'Space Alpha'])
      await expect
        .poll(
          async () => {
            const raw = await window.evaluate(async () => {
              return await window.opencoveApi.persistence.readWorkspaceStateRaw()
            })
            const parsed = raw
              ? (JSON.parse(raw) as {
                  workspaces?: Array<{ spaces?: Array<{ name?: string; sortOrder?: number }> }>
                })
              : null
            return [...(parsed?.workspaces?.[0]?.spaces ?? [])]
              .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
              .map(space => space.name)
          },
          { timeout: 15_000 },
        )
        .toEqual(['Space Beta', 'Space Gamma', 'Space Alpha'])
    } finally {
      await electronApp.close()
    }
  })

  test('reorders agents within the same sidebar group and persists sort order', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-agent-drag',
        workspaces: [
          {
            id: 'workspace-agent-drag',
            name: 'Agent Drag Project',
            path: testWorkspacePath,
            nodes: [
              createAgentNode('agent-alpha', 'Agent Alpha', 0),
              createAgentNode('agent-beta', 'Agent Beta', 1),
              createAgentNode('agent-gamma', 'Agent Gamma', 2),
            ],
          },
        ],
      })

      const agentTitles = window.locator('.workspace-agent-item__title')
      await expect(agentTitles).toHaveCount(3)
      await expect(agentTitles.nth(0)).toHaveText('Agent Alpha')

      const firstAgent = window.locator('.workspace-agent-item').filter({ hasText: 'Agent Alpha' })
      const thirdAgent = window.locator('.workspace-agent-item').filter({ hasText: 'Agent Gamma' })
      const firstRect = await readLocatorClientRect(firstAgent)
      const thirdRect = await readLocatorClientRect(thirdAgent)

      await dragMouse(window, {
        start: {
          x: firstRect.x + Math.min(firstRect.width / 2, 40),
          y: firstRect.y + firstRect.height / 2,
        },
        end: {
          x: thirdRect.x + Math.min(thirdRect.width / 2, 40),
          y: thirdRect.y + Math.max(thirdRect.height - 8, thirdRect.height * 0.7),
        },
        steps: 18,
        settleAfterPressMs: 48,
        settleBeforeReleaseMs: 80,
        settleAfterReleaseMs: 80,
      })

      await expect
        .poll(async () => await agentTitles.allTextContents(), { timeout: 8_000 })
        .toEqual(['Agent Beta', 'Agent Gamma', 'Agent Alpha'])
      await expect
        .poll(
          async () => {
            const raw = await window.evaluate(async () => {
              return await window.opencoveApi.persistence.readWorkspaceStateRaw()
            })
            const parsed = raw
              ? (JSON.parse(raw) as {
                  workspaces?: Array<{
                    nodes?: Array<{ title?: string; sidebarSortOrder?: number }>
                  }>
                })
              : null
            return [...(parsed?.workspaces?.[0]?.nodes ?? [])]
              .sort((left, right) => (left.sidebarSortOrder ?? 0) - (right.sidebarSortOrder ?? 0))
              .map(node => node.title?.replace('codex · ', ''))
          },
          { timeout: 15_000 },
        )
        .toEqual(['Agent Beta', 'Agent Gamma', 'Agent Alpha'])
    } finally {
      await electronApp.close()
    }
  })

  test('click still selects workspace after drag setup', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-click-a',
        workspaces: [
          {
            id: 'workspace-click-a',
            name: 'Click Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-click-b',
            name: 'Click Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
        ],
      })

      const activeItem = window.locator('.workspace-item.workspace-item--active')
      await expect(activeItem).toContainText('Click Alpha')

      // Click the second workspace — should select it, not start a drag
      const secondItem = window.locator('.workspace-item').filter({ hasText: 'Click Beta' }).first()
      await secondItem.click()

      await expect(activeItem).toContainText('Click Beta')
    } finally {
      await electronApp.close()
    }
  })

  test('right-click context menu still works on sortable items', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-ctx-a',
        workspaces: [
          {
            id: 'workspace-ctx-a',
            name: 'Context Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-ctx-b',
            name: 'Context Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
        ],
      })

      const secondItem = window
        .locator('.workspace-item')
        .filter({ hasText: 'Context Beta' })
        .first()
      await expect(secondItem).toBeVisible()

      await secondItem.click({ button: 'right' })

      const removeButton = window.locator(
        '[data-testid="workspace-project-remove-workspace-ctx-b"]',
      )
      await expect(removeButton).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })
})
