import { expect, test } from '@playwright/test'
import {
  launchApp,
  seedWorkspaceState,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Sidebar Workspaces', () => {
  test('keeps settings visible while the project list scrolls', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-scroll-0',
        workspaces: Array.from({ length: 18 }, (_, index) => ({
          id: `workspace-scroll-${index}`,
          name: `workspace-scroll-${index}`,
          path: `${testWorkspacePath}-scroll-${index}`,
          nodes: [],
        })),
      })

      const sidebar = window.locator('.workspace-sidebar')
      const sidebarList = window.locator('.workspace-sidebar__list')
      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      const lastWorkspaceName = window.locator('.workspace-item__name', {
        hasText: 'workspace-scroll-17',
      })

      await expect(settingsButton).toBeVisible()

      const sidebarMetrics = await sidebarList.evaluate(element => {
        element.scrollTop = element.scrollHeight

        return {
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
        }
      })

      expect(sidebarMetrics.scrollHeight).toBeGreaterThan(sidebarMetrics.clientHeight)
      expect(sidebarMetrics.scrollTop).toBeGreaterThan(0)
      await expect(lastWorkspaceName).toBeVisible()
      await expect(sidebar).toBeVisible()
      await expect(settingsButton).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('shows agents under each workspace and focuses selected workspace', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-a',
        workspaces: [
          {
            id: 'workspace-a',
            name: 'workspace-a',
            path: testWorkspacePath,
            nodes: [
              {
                id: 'agent-node-a',
                title: 'codex · gpt-5.2-codex',
                position: { x: 120, y: 120 },
                width: 520,
                height: 320,
                kind: 'agent',
                status: 'running',
                startedAt: '2026-02-09T08:00:00.000Z',
                endedAt: null,
                exitCode: null,
                lastError: null,
                agent: {
                  provider: 'codex',
                  prompt: 'task a',
                  model: 'gpt-5.2-codex',
                  effectiveModel: 'gpt-5.2-codex',
                  launchMode: 'new',
                  resumeSessionId: null,
                  executionDirectory: testWorkspacePath,
                  directoryMode: 'workspace',
                  customDirectory: null,
                  shouldCreateDirectory: false,
                },
              },
            ],
          },
          {
            id: 'workspace-b',
            name: 'workspace-b',
            path: `${testWorkspacePath}-b`,
            nodes: [
              {
                id: 'agent-node-b',
                title: 'claude · claude-opus-4-6',
                position: { x: 560, y: 420 },
                width: 520,
                height: 320,
                kind: 'agent',
                status: 'running',
                startedAt: '2026-02-09T09:00:00.000Z',
                endedAt: null,
                exitCode: null,
                lastError: null,
                agent: {
                  provider: 'claude-code',
                  prompt: 'task b',
                  model: 'claude-opus-4-6',
                  effectiveModel: 'claude-opus-4-6',
                  launchMode: 'new',
                  resumeSessionId: null,
                  executionDirectory: `${testWorkspacePath}-b`,
                  directoryMode: 'workspace',
                  customDirectory: null,
                  shouldCreateDirectory: false,
                },
              },
            ],
          },
        ],
      })

      const workspaceAGroup = window
        .locator('.workspace-item-group')
        .filter({ has: window.locator('.workspace-item__name', { hasText: 'workspace-a' }) })
      const workspaceBGroup = window
        .locator('.workspace-item-group')
        .filter({ has: window.locator('.workspace-item__name', { hasText: 'workspace-b' }) })

      await expect(
        workspaceAGroup.locator('.workspace-item__agents .workspace-agent-item'),
      ).toHaveCount(1)
      await expect(
        workspaceBGroup.locator('.workspace-item__agents .workspace-agent-item'),
      ).toHaveCount(1)

      await expect(
        workspaceAGroup.locator('[data-testid="workspace-agent-item-workspace-a-agent-node-a"]'),
      ).toBeVisible()
      await expect(
        workspaceBGroup.locator('[data-testid="workspace-agent-item-workspace-b-agent-node-b"]'),
      ).toBeVisible()

      await window.locator('[data-testid="workspace-agent-item-workspace-b-agent-node-b"]').click()
      await expect(window.locator('.workspace-item.workspace-item--active')).toContainText(
        'workspace-b',
      )
      await expect(window.locator('.terminal-node__title').first()).toContainText('claude')

      await window.locator('[data-testid="workspace-agent-item-workspace-a-agent-node-a"]').click()
      await expect(window.locator('.workspace-item.workspace-item--active')).toContainText(
        'workspace-a',
      )
      await expect(window.locator('.terminal-node__title').first()).toContainText('codex')
    } finally {
      await electronApp.close()
    }
  })

  test('removes project from sidebar via right-click menu', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-remove-b',
        workspaces: [
          {
            id: 'workspace-remove-a',
            name: 'workspace-remove-a',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-remove-b',
            name: 'workspace-remove-b',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
        ],
      })

      const targetWorkspace = window
        .locator('.workspace-item')
        .filter({ has: window.locator('.workspace-item__name', { hasText: 'workspace-remove-b' }) })
        .first()
      await expect(targetWorkspace).toBeVisible()

      await targetWorkspace.click({ button: 'right' })

      const removeButton = window.locator(
        '[data-testid="workspace-project-remove-workspace-remove-b"]',
      )
      await expect(removeButton).toBeVisible()

      await removeButton.click()

      const removeDialog = window.locator('[data-testid="workspace-project-delete-confirmation"]')
      await expect(removeDialog).toBeVisible()
      await expect(removeDialog).toContainText('workspace-remove-b')

      await window.locator('[data-testid="workspace-project-delete-confirm"]').click()
      await expect(removeDialog).toHaveCount(0)

      await expect(window.locator('.workspace-item')).toHaveCount(1)
      await expect(window.locator('.workspace-item.workspace-item--active')).toContainText(
        'workspace-remove-a',
      )

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
                activeWorkspaceId?: string | null
                workspaces?: Array<{
                  id?: string
                }>
              }

              return {
                activeWorkspaceId:
                  typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : null,
                workspaceIds: (parsed.workspaces ?? [])
                  .map(workspace => (typeof workspace.id === 'string' ? workspace.id : ''))
                  .filter(id => id.length > 0),
              }
            }, storageKey)
          },
          { timeout: 10_000 },
        )
        .toEqual({
          activeWorkspaceId: 'workspace-remove-a',
          workspaceIds: ['workspace-remove-a'],
        })
    } finally {
      await electronApp.close()
    }
  })
})
