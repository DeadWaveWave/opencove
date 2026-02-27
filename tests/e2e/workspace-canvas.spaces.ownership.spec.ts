import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  storageKey,
  testWorkspacePath,
} from './workspace-canvas.helpers'

test.describe('Workspace Canvas - Spaces (Ownership & Mismatch)', () => {
  test('moves nodes into/out of a space based on drop location', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-owned-node',
            title: 'terminal-owned',
            position: { x: 360, y: 260 },
            width: 460,
            height: 300,
          },
          {
            id: 'root-movable-node',
            title: 'terminal-root',
            position: { x: 120, y: 120 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-ownership',
              name: 'Ownership Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-owned-node'],
              rect: { x: 320, y: 220, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const rootNode = window.locator('.terminal-node').filter({ hasText: 'terminal-root' }).first()
      await expect(rootNode).toBeVisible()

      await rootNode.locator('.terminal-node__header').dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 520, y: 320 },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            ({ key, spaceId, nodeId }) => {
              const raw = window.localStorage.getItem(key)
              if (!raw) {
                return false
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  spaces?: Array<{
                    id?: string
                    nodeIds?: string[]
                  }>
                }>
              }

              const space = parsed.workspaces?.[0]?.spaces?.find(item => item.id === spaceId)
              return Boolean(space?.nodeIds?.includes(nodeId))
            },
            {
              key: storageKey,
              spaceId: 'space-ownership',
              nodeId: 'root-movable-node',
            },
          )
        })
        .toBe(true)

      await rootNode.locator('.terminal-node__header').dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 80, y: 760 },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            ({ key, spaceId, nodeId }) => {
              const raw = window.localStorage.getItem(key)
              if (!raw) {
                return null
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  spaces?: Array<{
                    id?: string
                    nodeIds?: string[]
                  }>
                }>
              }

              const space = parsed.workspaces?.[0]?.spaces?.find(item => item.id === spaceId)
              return space?.nodeIds?.includes(nodeId) ?? null
            },
            {
              key: storageKey,
              spaceId: 'space-ownership',
              nodeId: 'root-movable-node',
            },
          )
        })
        .toBe(false)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps dropped nodes fully inside the target space bounds (no straddling)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-boundary-node',
            title: 'terminal-boundary',
            position: { x: 420, y: 340 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-boundary',
              name: 'Boundary Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-boundary-node'],
              rect: { x: 340, y: 280, width: 620, height: 420 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const boundaryNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'terminal-boundary' })
        .first()
      await expect(boundaryNode).toBeVisible()

      await boundaryNode.locator('.terminal-node__header').dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 350, y: 340 },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            ({ key, nodeId, spaceId }) => {
              const raw = window.localStorage.getItem(key)
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
              const node = workspace?.nodes?.find(item => item.id === nodeId)
              const space = workspace?.spaces?.find(item => item.id === spaceId)

              if (
                !node?.position ||
                typeof node.position.x !== 'number' ||
                typeof node.position.y !== 'number' ||
                typeof node.width !== 'number' ||
                typeof node.height !== 'number' ||
                !space?.rect ||
                typeof space.rect.x !== 'number' ||
                typeof space.rect.y !== 'number' ||
                typeof space.rect.width !== 'number' ||
                typeof space.rect.height !== 'number'
              ) {
                return false
              }

              const nodeRight = node.position.x + node.width
              const nodeBottom = node.position.y + node.height
              const spaceRight = space.rect.x + space.rect.width
              const spaceBottom = space.rect.y + space.rect.height

              return (
                node.position.x >= space.rect.x &&
                node.position.y >= space.rect.y &&
                nodeRight <= spaceRight &&
                nodeBottom <= spaceBottom
              )
            },
            { key: storageKey, nodeId: 'space-boundary-node', spaceId: 'space-boundary' },
          )
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('prevents overlaps when drop clamping moves nodes inside a space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-overlap-static-node',
            title: 'terminal-static',
            position: { x: 360, y: 220 },
            width: 460,
            height: 300,
          },
          {
            id: 'space-overlap-drag-node',
            title: 'terminal-drag',
            position: { x: 360, y: 260 },
            width: 460,
            height: 300,
          },
        ],
        {
          spaces: [
            {
              id: 'space-overlap',
              name: 'Overlap Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-overlap-static-node', 'space-overlap-drag-node'],
              rect: { x: 200, y: 200, width: 1200, height: 600 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const draggedNode = window.locator('.terminal-node').filter({ hasText: 'terminal-drag' }).first()
      await expect(draggedNode).toBeVisible()

      await draggedNode.locator('.terminal-node__header').dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 440, y: 700 },
      })

      await expect
        .poll(async () => {
          return await window.evaluate(
            ({ key, spaceId, nodeAId, nodeBId }) => {
              const raw = window.localStorage.getItem(key)
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

              const overlaps = !(aRight <= bLeft || aLeft >= bRight || aBottom <= bTop || aTop >= bBottom)

              return nodeAInside && nodeBInside && !overlaps
            },
            {
              key: storageKey,
              spaceId: 'space-overlap',
              nodeAId: 'space-overlap-static-node',
              nodeBId: 'space-overlap-drag-node',
            },
          )
        })
        .toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('creates new tasks in the space under the cursor (right-click anchor)', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-anchor-placeholder',
            title: 'placeholder-task',
            position: { x: 420, y: 260 },
            width: 460,
            height: 280,
            kind: 'task',
            status: null,
            task: {
              requirement: 'placeholder',
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
        ],
        {
          spaces: [
            {
              id: 'space-anchor',
              name: 'Anchor Scope',
              directoryPath: testWorkspacePath,
              nodeIds: ['space-anchor-placeholder'],
              rect: { x: 340, y: 200, width: 700, height: 520 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      await pane.click({
        button: 'right',
        position: { x: 380, y: 240 },
      })
      await window.locator('[data-testid="workspace-context-new-task"]').click()

      await expect(window.locator('[data-testid="workspace-task-creator"]')).toBeVisible()
      await window.locator('[data-testid="workspace-task-title"]').fill('Anchored Task')
      await window
        .locator('[data-testid="workspace-task-requirement"]')
        .fill('Created inside space anchor')
      await window.locator('[data-testid="workspace-task-create-submit"]').click()

      await expect(window.locator('.task-node')).toHaveCount(2)

      const belongs = await window.evaluate(
        ({ key, spaceId }) => {
          const raw = window.localStorage.getItem(key)
          if (!raw) {
            return null
          }

          const parsed = JSON.parse(raw) as {
            workspaces?: Array<{
              nodes?: Array<{ id?: string; kind?: string; task?: { requirement?: string } | null }>
              spaces?: Array<{ id?: string; nodeIds?: string[] }>
            }>
          }

          const workspace = parsed.workspaces?.[0]
          if (!workspace) {
            return null
          }

          const createdTask = (workspace.nodes ?? []).find(
            node =>
              node.kind === 'task' && node.task?.requirement === 'Created inside space anchor',
          )
          const space = (workspace.spaces ?? []).find(item => item.id === spaceId)

          return createdTask?.id && Array.isArray(space?.nodeIds)
            ? space?.nodeIds.includes(createdTask.id)
            : null
        },
        { key: storageKey, spaceId: 'space-anchor' },
      )

      expect(belongs).toBe(true)
    } finally {
      await electronApp.close()
    }
  })

  test('marks terminal/agent directory mismatch when moving into another directory space', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const worktreePath = `${testWorkspacePath}/.cove/worktrees/wt-ownership`

      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'space-placeholder-task',
            title: 'task-in-space',
            position: { x: 720, y: 240 },
            width: 360,
            height: 220,
            kind: 'task',
            status: null,
            task: {
              requirement: 'placeholder',
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
            id: 'mismatch-agent',
            title: 'codex · gpt-5.2-codex',
            position: { x: 120, y: 120 },
            width: 520,
            height: 320,
            kind: 'agent',
            status: 'running',
            startedAt: '2026-02-09T00:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            agent: {
              provider: 'codex',
              prompt: 'dir mismatch test',
              model: 'gpt-5.2-codex',
              effectiveModel: 'gpt-5.2-codex',
              launchMode: 'resume',
              resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
              executionDirectory: testWorkspacePath,
              expectedDirectory: testWorkspacePath,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
              taskId: null,
            },
          },
        ],
        {
          spaces: [
            {
              id: 'space-worktree',
              name: 'Worktree Scope',
              directoryPath: worktreePath,
              nodeIds: ['space-placeholder-task'],
              rect: { x: 680, y: 200, width: 520, height: 360 },
            },
          ],
          activeSpaceId: null,
        },
      )

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const agentNode = window
        .locator('.terminal-node')
        .filter({ hasText: 'codex · gpt-5.2-codex' })
        .first()
      await expect(agentNode).toBeVisible()
      await expect(agentNode.locator('.terminal-node__badge--warning')).toHaveCount(0)

      await agentNode.locator('.terminal-node__header').dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 820, y: 320 },
      })

      await expect(agentNode.locator('.terminal-node__badge--warning')).toContainText(
        'DIR MISMATCH',
      )

      await expect
        .poll(async () => {
          return await window.evaluate(
            ({ key, nodeId }) => {
              const raw = window.localStorage.getItem(key)
              if (!raw) {
                return null
              }

              const parsed = JSON.parse(raw) as {
                workspaces?: Array<{
                  nodes?: Array<{
                    id?: string
                    agent?: {
                      expectedDirectory?: string | null
                    } | null
                  }>
                }>
              }

              const node = parsed.workspaces?.[0]?.nodes?.find(item => item.id === nodeId)
              return node?.agent?.expectedDirectory ?? null
            },
            { key: storageKey, nodeId: 'mismatch-agent' },
          )
        })
        .toBe(worktreePath)

      const paneBox = await pane.boundingBox()
      if (!paneBox) {
        throw new Error('workspace pane bounding box unavailable')
      }

      await agentNode.locator('.terminal-node__header').dragTo(pane, {
        sourcePosition: { x: 80, y: 16 },
        targetPosition: { x: 120, y: Math.max(120, paneBox.height - 40) },
      })

      await expect(agentNode.locator('.terminal-node__badge--warning')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
