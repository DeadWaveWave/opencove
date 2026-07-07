import { expect, test, type Locator, type Page } from '@playwright/test'
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

async function dragBelowActivationDistance(window: Page, source: Locator): Promise<void> {
  const rect = await readLocatorClientRect(source)
  const start = {
    x: rect.x + Math.min(rect.width / 2, 40),
    y: rect.y + rect.height / 2,
  }

  await dragMouse(window, {
    start,
    end: { x: start.x, y: start.y + 6 },
    steps: 3,
    settleAfterPressMs: 20,
    settleBeforeReleaseMs: 20,
    settleAfterReleaseMs: 160,
  })
}

async function dragMeasuredTo(window: Page, source: Locator, target: Locator): Promise<void> {
  const sourceRect = await readLocatorClientRect(source)
  const targetRect = await readLocatorClientRect(target)

  await dragMouse(window, {
    start: {
      x: sourceRect.x + Math.min(sourceRect.width / 2, 40),
      y: sourceRect.y + sourceRect.height / 2,
    },
    end: {
      x: targetRect.x + Math.min(targetRect.width / 2, 40),
      y: targetRect.y + targetRect.height / 2,
    },
    steps: 18,
    settleAfterPressMs: 48,
    settleBeforeReleaseMs: 80,
    settleAfterReleaseMs: 180,
  })
}

async function readTestIds(window: Page, selector: string): Promise<string[]> {
  return await window
    .locator(selector)
    .evaluateAll(elements =>
      elements
        .map(element => element.getAttribute('data-testid') ?? '')
        .filter(testId => testId.length > 0),
    )
}

test.describe('Workspace Canvas - Sidebar Drag Boundaries', () => {
  test('keeps project, space, and agent order stable below the activation distance', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-threshold-a',
        workspaces: [
          {
            id: 'workspace-threshold-a',
            name: 'Threshold Alpha',
            path: testWorkspacePath,
            nodes: [
              createAgentNode('agent-threshold-a', 'Agent Threshold Alpha', 0),
              createAgentNode('agent-threshold-b', 'Agent Threshold Beta', 1),
            ],
            spaces: [
              {
                id: 'space-threshold-a',
                name: 'Space Threshold Alpha',
                directoryPath: testWorkspacePath,
                sortOrder: 0,
                labelColor: 'blue',
                nodeIds: [],
              },
              {
                id: 'space-threshold-b',
                name: 'Space Threshold Beta',
                directoryPath: testWorkspacePath,
                sortOrder: 1,
                labelColor: 'green',
                nodeIds: [],
              },
            ],
          },
          {
            id: 'workspace-threshold-b',
            name: 'Threshold Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
          {
            id: 'workspace-threshold-c',
            name: 'Threshold Gamma',
            path: `${testWorkspacePath}-c`,
            nodes: [],
          },
        ],
      })

      const workspaceNames = window.locator('.workspace-item__name')
      const agentTitles = window.locator('.workspace-agent-item__title')
      const spaceSelector =
        '[data-testid^="workspace-space-item-workspace-threshold-a-space-threshold"]'

      await expect(workspaceNames).toHaveText([
        'Threshold Alpha',
        'Threshold Beta',
        'Threshold Gamma',
      ])
      await expect(agentTitles).toHaveText(['Agent Threshold Alpha', 'Agent Threshold Beta'])
      expect(await readTestIds(window, spaceSelector)).toEqual([
        'workspace-space-item-workspace-threshold-a-space-threshold-a',
        'workspace-space-item-workspace-threshold-a-space-threshold-b',
      ])

      await dragBelowActivationDistance(
        window,
        window.locator('[data-testid="workspace-item-workspace-threshold-b"]'),
      )
      await dragBelowActivationDistance(
        window,
        window.locator(
          '[data-testid="workspace-space-item-workspace-threshold-a-space-threshold-a"]',
        ),
      )
      await dragBelowActivationDistance(
        window,
        window.locator(
          '[data-testid="workspace-agent-item-workspace-threshold-a-agent-threshold-a"]',
        ),
      )

      await window.waitForTimeout(250)
      await expect(workspaceNames).toHaveText([
        'Threshold Alpha',
        'Threshold Beta',
        'Threshold Gamma',
      ])
      await expect(agentTitles).toHaveText(['Agent Threshold Alpha', 'Agent Threshold Beta'])
      expect(await readTestIds(window, spaceSelector)).toEqual([
        'workspace-space-item-workspace-threshold-a-space-threshold-a',
        'workspace-space-item-workspace-threshold-a-space-threshold-b',
      ])
    } finally {
      await electronApp.close()
    }
  })

  test('keeps root space order stable when dragging across project boundaries', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-space-boundary-a',
        workspaces: [
          {
            id: 'workspace-space-boundary-a',
            name: 'Space Boundary A',
            path: testWorkspacePath,
            nodes: [],
            spaces: [
              {
                id: 'space-boundary-a1',
                name: 'Space Boundary A1',
                directoryPath: testWorkspacePath,
                sortOrder: 0,
                labelColor: 'blue',
                nodeIds: [],
              },
              {
                id: 'space-boundary-a2',
                name: 'Space Boundary A2',
                directoryPath: testWorkspacePath,
                sortOrder: 1,
                labelColor: 'green',
                nodeIds: [],
              },
            ],
          },
          {
            id: 'workspace-space-boundary-b',
            name: 'Space Boundary B',
            path: `${testWorkspacePath}-b`,
            nodes: [],
            spaces: [
              {
                id: 'space-boundary-b1',
                name: 'Space Boundary B1',
                directoryPath: `${testWorkspacePath}-b`,
                sortOrder: 0,
                labelColor: 'purple',
                nodeIds: [],
              },
              {
                id: 'space-boundary-b2',
                name: 'Space Boundary B2',
                directoryPath: `${testWorkspacePath}-b`,
                sortOrder: 1,
                labelColor: 'yellow',
                nodeIds: [],
              },
            ],
          },
        ],
      })

      const projectASelector =
        '[data-testid^="workspace-space-item-workspace-space-boundary-a-space-boundary-a"]'
      const projectBSelector =
        '[data-testid^="workspace-space-item-workspace-space-boundary-b-space-boundary-b"]'

      await dragMeasuredTo(
        window,
        window.locator(
          '[data-testid="workspace-space-item-workspace-space-boundary-a-space-boundary-a1"]',
        ),
        window.locator(
          '[data-testid="workspace-space-item-workspace-space-boundary-b-space-boundary-b2"]',
        ),
      )

      expect(await readTestIds(window, projectASelector)).toEqual([
        'workspace-space-item-workspace-space-boundary-a-space-boundary-a1',
        'workspace-space-item-workspace-space-boundary-a-space-boundary-a2',
      ])
      expect(await readTestIds(window, projectBSelector)).toEqual([
        'workspace-space-item-workspace-space-boundary-b-space-boundary-b1',
        'workspace-space-item-workspace-space-boundary-b-space-boundary-b2',
      ])
    } finally {
      await electronApp.close()
    }
  })

  test('keeps agent order stable when dragging across space groups', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-agent-boundary',
        workspaces: [
          {
            id: 'workspace-agent-boundary',
            name: 'Agent Boundary',
            path: testWorkspacePath,
            nodes: [
              createAgentNode('agent-boundary-a1', 'Agent Boundary A1', 0),
              createAgentNode('agent-boundary-a2', 'Agent Boundary A2', 1),
              createAgentNode('agent-boundary-b1', 'Agent Boundary B1', 2),
              createAgentNode('agent-boundary-b2', 'Agent Boundary B2', 3),
            ],
            spaces: [
              {
                id: 'space-agent-boundary-a',
                name: 'Agent Space A',
                directoryPath: testWorkspacePath,
                sortOrder: 0,
                labelColor: 'blue',
                nodeIds: ['agent-boundary-a1', 'agent-boundary-a2'],
              },
              {
                id: 'space-agent-boundary-b',
                name: 'Agent Space B',
                directoryPath: testWorkspacePath,
                sortOrder: 1,
                labelColor: 'green',
                nodeIds: ['agent-boundary-b1', 'agent-boundary-b2'],
              },
            ],
          },
        ],
      })

      const agentTitles = window.locator('.workspace-agent-item__title')
      await expect(agentTitles).toHaveText([
        'Agent Boundary A1',
        'Agent Boundary A2',
        'Agent Boundary B1',
        'Agent Boundary B2',
      ])

      await dragMeasuredTo(
        window,
        window.locator(
          '[data-testid="workspace-agent-item-workspace-agent-boundary-agent-boundary-a1"]',
        ),
        window.locator(
          '[data-testid="workspace-agent-item-workspace-agent-boundary-agent-boundary-b2"]',
        ),
      )

      await expect(agentTitles).toHaveText([
        'Agent Boundary A1',
        'Agent Boundary A2',
        'Agent Boundary B1',
        'Agent Boundary B2',
      ])
    } finally {
      await electronApp.close()
    }
  })
})
