import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  beginDragMouse,
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

async function readClosestOpacity(locator: Locator, selector: string): Promise<number> {
  return await locator.evaluate((element, targetSelector) => {
    const target = element.closest(targetSelector)
    if (!(target instanceof HTMLElement)) {
      return Number.NaN
    }

    return Number.parseFloat(window.getComputedStyle(target).opacity)
  }, selector)
}

async function readClosestTranslateY(locator: Locator, selector: string): Promise<number> {
  return await locator.evaluate((element, targetSelector) => {
    const target = element.closest(targetSelector)
    if (!(target instanceof HTMLElement)) {
      return Number.NaN
    }

    const transform = window.getComputedStyle(target).transform
    if (!transform || transform === 'none') {
      return 0
    }

    const values = transform
      .slice(transform.indexOf('(') + 1, transform.lastIndexOf(')'))
      .split(',')
      .map(value => Number.parseFloat(value.trim()))

    return transform.startsWith('matrix3d(') ? (values[13] ?? 0) : (values[5] ?? 0)
  }, selector)
}

async function dragUpWithMeasuredFeedback({
  window,
  source,
  target,
  kind,
  sortableSelector,
}: {
  window: Page
  source: Locator
  target: Locator
  kind: 'project' | 'space' | 'agent'
  sortableSelector: string
}): Promise<void> {
  const sourceRect = await readLocatorClientRect(source)
  const targetRect = await readLocatorClientRect(target)
  const overlay = window.locator('[data-testid="workspace-sidebar-drag-overlay"]')
  const pointerX = sourceRect.x + Math.min(sourceRect.width / 2, 40)
  const drag = await beginDragMouse(window, {
    start: {
      x: pointerX,
      y: sourceRect.y + sourceRect.height / 2,
    },
    initialTarget: {
      x: pointerX,
      y: targetRect.y + targetRect.height / 2,
    },
    triggerDistance: 12,
    steps: 18,
    settleAfterPressMs: 72,
    draft: overlay,
    draftTimeoutMs: 4_000,
    settleBeforeReleaseMs: 80,
    settleAfterReleaseMs: 120,
  })

  await expect(overlay).toHaveAttribute('data-cove-sidebar-drag-kind', kind)
  const overlayRect = await readLocatorClientRect(overlay)
  expect(overlayRect.height).toBeGreaterThan(20)
  expect(await readClosestOpacity(source, sortableSelector)).toBeLessThan(0.7)

  await drag.moveTo(
    {
      x: targetRect.x + Math.min(targetRect.width / 2, 40),
      y: targetRect.y + targetRect.height / 2,
    },
    { steps: 18, settleAfterMoveMs: 140 },
  )

  await expect
    .poll(async () => await readClosestTranslateY(target, sortableSelector), { timeout: 3_000 })
    .toBeGreaterThan(8)
  await drag.release()
}

test.describe('Workspace Canvas - Sidebar Drag Motion', () => {
  test('uses one overlay and stable upward displacement when reordering projects', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-motion-a',
        workspaces: [
          {
            id: 'workspace-motion-a',
            name: 'Project Alpha',
            path: testWorkspacePath,
            nodes: [],
          },
          {
            id: 'workspace-motion-b',
            name: 'Project Beta',
            path: `${testWorkspacePath}-b`,
            nodes: [],
          },
          {
            id: 'workspace-motion-c',
            name: 'Project Gamma',
            path: `${testWorkspacePath}-c`,
            nodes: [],
          },
        ],
      })

      await dragUpWithMeasuredFeedback({
        window,
        source: window.locator('.workspace-item').filter({ hasText: 'Project Gamma' }).first(),
        target: window.locator('.workspace-item').filter({ hasText: 'Project Alpha' }).first(),
        kind: 'project',
        sortableSelector: '.workspace-item-group',
      })

      await expect
        .poll(async () => await window.locator('.workspace-item__name').allTextContents())
        .toEqual(['Project Gamma', 'Project Alpha', 'Project Beta'])
    } finally {
      await electronApp.close()
    }
  })

  test('uses one overlay and stable upward displacement when reordering spaces', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-space-motion',
        workspaces: [
          {
            id: 'workspace-space-motion',
            name: 'Space Motion Project',
            path: testWorkspacePath,
            nodes: [],
            spaces: [
              {
                id: 'space-motion-a',
                name: 'Space Alpha',
                directoryPath: testWorkspacePath,
                sortOrder: 0,
                labelColor: 'blue',
                nodeIds: [],
              },
              {
                id: 'space-motion-b',
                name: 'Space Beta',
                directoryPath: testWorkspacePath,
                sortOrder: 1,
                labelColor: 'green',
                nodeIds: [],
              },
              {
                id: 'space-motion-c',
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

      await dragUpWithMeasuredFeedback({
        window,
        source: window
          .locator('.workspace-space-item:not(.workspace-space-item--drag-overlay)')
          .filter({ hasText: 'Space Gamma' }),
        target: window
          .locator('.workspace-space-item:not(.workspace-space-item--drag-overlay)')
          .filter({ hasText: 'Space Alpha' }),
        kind: 'space',
        sortableSelector: '.workspace-space-group',
      })

      await expect
        .poll(async () => await window.locator('.workspace-space-item__name').allTextContents())
        .toEqual(['Space Gamma', 'Space Alpha', 'Space Beta'])
    } finally {
      await electronApp.close()
    }
  })

  test('uses one overlay and stable upward displacement when reordering agents', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-agent-motion',
        workspaces: [
          {
            id: 'workspace-agent-motion',
            name: 'Agent Motion Project',
            path: testWorkspacePath,
            nodes: [
              createAgentNode('agent-motion-a', 'Agent Alpha', 0),
              createAgentNode('agent-motion-b', 'Agent Beta', 1),
              createAgentNode('agent-motion-c', 'Agent Gamma', 2),
            ],
          },
        ],
      })

      await dragUpWithMeasuredFeedback({
        window,
        source: window
          .locator('.workspace-agent-item:not(.workspace-agent-item--drag-overlay)')
          .filter({ hasText: 'Agent Gamma' }),
        target: window
          .locator('.workspace-agent-item:not(.workspace-agent-item--drag-overlay)')
          .filter({ hasText: 'Agent Alpha' }),
        kind: 'agent',
        sortableSelector: '.workspace-agent-item',
      })

      await expect
        .poll(async () => await window.locator('.workspace-agent-item__title').allTextContents())
        .toEqual(['Agent Gamma', 'Agent Alpha', 'Agent Beta'])
    } finally {
      await electronApp.close()
    }
  })
})
