import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, testWorkspacePath } from './workspace-canvas.helpers'
import {
  clickPaneAtFlowPoint,
  ensureArtifactsDir,
  openPaneContextMenuAtFlowPoint,
  openPaneContextMenuInSpace,
  readSeededWorkspaceLayout,
  rectsOverlap,
} from './workspace-canvas.arrange.shared'

test.describe('Workspace Canvas - Arrange', () => {
  test('arrange menus keep toggles visible while applying the tiled layout', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'tile-1',
            title: 'tile-1',
            position: { x: 0, y: 0 },
            width: 470,
            height: 650,
          },
          {
            id: 'tile-2',
            title: 'tile-2',
            position: { x: 0, y: 0 },
            width: 468,
            height: 660,
          },
          {
            id: 'tile-3',
            title: 'tile-3',
            position: { x: 0, y: 0 },
            width: 455,
            height: 645,
          },
          {
            id: 'tile-4',
            title: 'tile-4',
            position: { x: 0, y: 0 },
            width: 480,
            height: 670,
          },
        ],
        {
          spaces: [
            {
              id: 'space-tiles',
              name: 'Tiles',
              directoryPath: testWorkspacePath,
              nodeIds: ['tile-1', 'tile-2', 'tile-3', 'tile-4'],
              rect: { x: 100, y: 100, width: 1024, height: 800 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node')).toHaveCount(4)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      await openPaneContextMenuInSpace(window, pane, 'space-tiles')

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await ensureArtifactsDir()
      await window.screenshot({ path: 'artifacts/workspace-canvas-arrange.arrange-by-menu.png' })

      await expect(
        window.locator('[data-testid="workspace-context-magnetic-snapping"]'),
      ).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-canonical-sizes"]'),
      ).toHaveCount(0)
      await expect(
        window.locator('[data-testid="workspace-context-arrange-magnetic-snapping"]'),
      ).toHaveCount(0)
      await expect(
        window.locator('[data-testid="workspace-context-arrange-space-fit-grow"]'),
      ).toHaveCount(0)

      await window.locator('[data-testid="workspace-context-magnetic-snapping"]').click()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()
      await window.locator('[data-testid="workspace-context-magnetic-snapping"]').click()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeVisible()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await expect(window.locator('.workspace-context-menu__section-title')).toContainText('Space')

      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.arrange-by-menu.standard-sizes.png',
      })

      await window.locator('[data-testid="workspace-context-arrange-space-fit-tight"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['tile-1', 'tile-2', 'tile-3', 'tile-4'],
            spaceIds: ['space-tiles'],
          })
        })
        .toEqual({
          nodes: {
            'tile-1': { x: 124, y: 124, width: 468, height: 324 },
            'tile-2': { x: 604, y: 124, width: 468, height: 324 },
            'tile-3': { x: 124, y: 460, width: 468, height: 324 },
            'tile-4': { x: 604, y: 460, width: 468, height: 324 },
          },
          spaces: {
            'space-tiles': { x: 100, y: 100, width: 996, height: 708 },
          },
        })

      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.standard-tiled-tiles.png',
      })
    } finally {
      await electronApp.close()
    }
  })

  test('arrange submenu stays open and places spaces above root nodes', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'root-a',
            title: 'root-a',
            position: { x: 80, y: 40 },
            width: 320,
            height: 240,
          },
          {
            id: 'root-b',
            title: 'root-b',
            position: { x: 960, y: 80 },
            width: 320,
            height: 240,
          },
          {
            id: 'space-a',
            title: 'space-a',
            position: { x: 620, y: 340 },
            width: 320,
            height: 240,
          },
          {
            id: 'space-b',
            title: 'space-b',
            position: { x: 980, y: 340 },
            width: 320,
            height: 240,
          },
        ],
        {
          spaces: [
            {
              id: 'space-1',
              name: 'Space 1',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-a', 'space-b'],
              rect: { x: 580, y: 300, width: 760, height: 320 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await openPaneContextMenuAtFlowPoint(window, pane, { x: 40, y: 40 })

      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await window.locator('[data-testid="workspace-context-arrange-scope-all"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()
      await expect(window.locator('[data-testid="workspace-context-arrange"]')).toBeVisible()

      await ensureArtifactsDir()
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.tiled-layout-menu.png',
      })

      await expect
        .poll(async () => {
          return await readSeededWorkspaceLayout(window, {
            nodeIds: ['root-a', 'root-b', 'space-a', 'space-b'],
            spaceIds: ['space-1'],
          })
        })
        .toMatchObject({
          nodes: {
            'root-a': { width: 468, height: 324 },
            'root-b': { width: 468, height: 324 },
            'space-a': { width: 468, height: 324 },
            'space-b': { width: 468, height: 324 },
          },
        })
      const layout = await readSeededWorkspaceLayout(window, {
        nodeIds: ['root-a', 'root-b', 'space-a', 'space-b'],
        spaceIds: ['space-1'],
      })

      const spaceRect = layout.spaces['space-1']
      const rootA = layout.nodes['root-a']
      const rootB = layout.nodes['root-b']

      expect(spaceRect).toBeTruthy()
      expect(rootA).toBeTruthy()
      expect(rootB).toBeTruthy()
      expect(spaceRect!.y + spaceRect!.height).toBeLessThanOrEqual(Math.min(rootA!.y, rootB!.y))
      expect(rectsOverlap(rootA!, rootB!)).toBe(false)

      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.tiled-layout-canvas.png',
      })
    } finally {
      await electronApp.close()
    }
  })

  test('size ordering packs mixed nodes into the tiled layout inside a space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'mixed-agent',
            title: 'codex · gpt-5.2-codex',
            position: { x: 0, y: 0 },
            width: 560,
            height: 720,
            kind: 'agent',
            status: 'running',
            startedAt: '2026-02-08T15:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            agent: {
              provider: 'codex',
              prompt: 'Arrange a mixed grid',
              model: 'gpt-5.2-codex',
              effectiveModel: 'gpt-5.2-codex',
              launchMode: 'new',
              resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
              resumeSessionIdVerified: true,
              executionDirectory: testWorkspacePath,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
            },
          },
          {
            id: 'mixed-terminal',
            title: 'mixed-terminal',
            position: { x: 0, y: 0 },
            width: 470,
            height: 650,
            kind: 'terminal',
          },
          {
            id: 'mixed-task-1',
            title: 'mixed-task-1',
            position: { x: 0, y: 0 },
            width: 420,
            height: 300,
            kind: 'task',
            status: null,
            task: {
              requirement: 'Task 1',
              status: 'todo',
              priority: 'low',
              tags: [],
              linkedAgentNodeId: null,
              agentSessions: [],
              lastRunAt: null,
              autoGeneratedTitle: false,
              createdAt: '2026-02-09T00:00:00.000Z',
              updatedAt: '2026-02-09T00:00:00.000Z',
            },
          },
          {
            id: 'mixed-task-2',
            title: 'mixed-task-2',
            position: { x: 0, y: 0 },
            width: 410,
            height: 290,
            kind: 'task',
            status: null,
            task: {
              requirement: 'Task 2',
              status: 'todo',
              priority: 'low',
              tags: [],
              linkedAgentNodeId: null,
              agentSessions: [],
              lastRunAt: null,
              autoGeneratedTitle: false,
              createdAt: '2026-02-10T00:00:00.000Z',
              updatedAt: '2026-02-10T00:00:00.000Z',
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-mixed',
              name: 'Mixed',
              directoryPath: testWorkspacePath,
              nodeIds: ['mixed-agent', 'mixed-terminal', 'mixed-task-1', 'mixed-task-2'],
              rect: { x: 100, y: 100, width: 1008, height: 800 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()
      await expect(window.locator('.react-flow__node')).toHaveCount(4)
      await expect(window.locator('.workspace-space-region')).toHaveCount(1)

      await openPaneContextMenuInSpace(window, pane, 'space-mixed')
      await expect(window.locator('.workspace-context-menu')).toBeVisible()
      await window.locator('[data-testid="workspace-context-arrange-by"]').click()
      await expect(
        window.locator('[data-testid="workspace-context-arrange-by-menu"]'),
      ).toBeVisible()

      await window.locator('[data-testid="workspace-context-arrange-order-size"]').click()

      const layout = await readSeededWorkspaceLayout(window, {
        nodeIds: ['mixed-agent', 'mixed-terminal', 'mixed-task-1', 'mixed-task-2'],
        spaceIds: ['space-mixed'],
      })

      const spaceRect = layout.spaces['space-mixed']
      expect(spaceRect).toEqual({ x: 100, y: 100, width: 1236, height: 708 })

      expect(layout.nodes['mixed-agent']).toMatchObject({ width: 468, height: 660 })
      expect(layout.nodes['mixed-terminal']).toMatchObject({ width: 468, height: 324 })
      expect(layout.nodes['mixed-task-1']).toMatchObject({ width: 228, height: 324 })
      expect(layout.nodes['mixed-task-2']).toMatchObject({ width: 228, height: 324 })

      expect(layout.nodes['mixed-task-1']).toMatchObject({ x: 124, y: 124 })
      expect(layout.nodes['mixed-task-2']).toMatchObject({ x: 124, y: 460 })
      expect(layout.nodes['mixed-agent']).toMatchObject({ x: 364, y: 124 })
      expect(layout.nodes['mixed-terminal']).toMatchObject({ x: 844, y: 124 })

      const rects = ['mixed-agent', 'mixed-terminal', 'mixed-task-1', 'mixed-task-2'].map(
        id => layout.nodes[id],
      )
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false)
        }
      }

      await ensureArtifactsDir()
      await clickPaneAtFlowPoint(window, pane, { x: 20, y: 20 })
      await expect(window.locator('.workspace-context-menu')).toHaveCount(0)
      await window.screenshot({
        path: 'artifacts/workspace-canvas-arrange.standard-tiled-mixed.png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
