import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const recoveryEnv = {
  OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
  OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'jsonl-stdin-submit-driven-turn',
} as const

async function readWorkspaceStateRaw(window: Page): Promise<unknown | null> {
  const raw = await window.evaluate(async () => {
    return await window.opencoveApi.persistence.readWorkspaceStateRaw()
  })

  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function readTaskLinkedAgentBinding(window: Page): Promise<{
  linkedAgentNodeId: string | null
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
}> {
  const parsed = (await readWorkspaceStateRaw(window)) as {
    workspaces?: Array<{
      nodes?: Array<{
        id?: string
        kind?: string
        task?: { linkedAgentNodeId?: string | null } | null
        agent?: {
          resumeSessionId?: string | null
          resumeSessionIdVerified?: boolean
        } | null
      }>
    }>
  } | null

  const nodes = parsed?.workspaces?.[0]?.nodes ?? []
  const task = nodes.find(node => node.kind === 'task')
  const linkedAgentNodeId = task?.task?.linkedAgentNodeId ?? null
  const agent = linkedAgentNodeId
    ? nodes.find(node => node.kind === 'agent' && node.id === linkedAgentNodeId)
    : null

  return {
    linkedAgentNodeId,
    resumeSessionId: agent?.agent?.resumeSessionId ?? null,
    resumeSessionIdVerified: agent?.agent?.resumeSessionIdVerified ?? false,
  }
}

async function readFirstAgentGeometry(window: Page): Promise<{
  terminalSize: { cols: number; rows: number } | null
  snapshotSize: { cols: number; rows: number } | null
  horizontalOverflowPx: number | null
  verticalOverflowPx: number | null
}> {
  return await window.evaluate(async () => {
    const agentNode = document.querySelector('.terminal-node')
    const container = agentNode?.querySelector('.terminal-node__terminal')
    if (!(agentNode instanceof HTMLElement) || !(container instanceof HTMLElement)) {
      return {
        terminalSize: null,
        snapshotSize: null,
        horizontalOverflowPx: null,
        verticalOverflowPx: null,
      }
    }

    const nodeId =
      agentNode.closest('.react-flow__node')?.getAttribute('data-id') ??
      agentNode.closest('[data-id]')?.getAttribute('data-id') ??
      ''
    const terminalSize = window.__opencoveTerminalSelectionTestApi?.getSize(nodeId) ?? null
    const runtimeSessionId =
      window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(nodeId) ?? null
    const metrics = window.__opencoveTerminalSelectionTestApi?.getRenderMetrics?.(nodeId) ?? null
    const snapshot =
      typeof runtimeSessionId === 'string' && runtimeSessionId.length > 0
        ? await window.opencoveApi.pty
            .presentationSnapshot({ sessionId: runtimeSessionId })
            .catch(() => null)
        : null
    const screen =
      container.querySelector('.xterm-screen canvas') ?? container.querySelector('.xterm-screen')
    const screenRect = screen instanceof HTMLElement ? screen.getBoundingClientRect() : null
    const contentWidth =
      terminalSize && metrics?.cssCellWidth && metrics.cssCellWidth > 0
        ? terminalSize.cols * metrics.cssCellWidth
        : (screenRect?.width ?? null)
    const contentHeight =
      terminalSize && metrics?.cssCellHeight && metrics.cssCellHeight > 0
        ? terminalSize.rows * metrics.cssCellHeight
        : (screenRect?.height ?? null)

    return {
      terminalSize,
      snapshotSize: snapshot ? { cols: snapshot.cols, rows: snapshot.rows } : null,
      horizontalOverflowPx:
        contentWidth === null ? null : Math.max(0, contentWidth - container.clientWidth),
      verticalOverflowPx:
        contentHeight === null ? null : Math.max(0, contentHeight - container.clientHeight),
    }
  })
}

test.describe('Recovery - task Claude agent (Windows)', () => {
  test.skip(process.platform !== 'win32', 'Windows-specific agent recovery regression')

  test('restores task-launched claude-code after restart without terminal overflow', async () => {
    const userDataDir = await createTestUserDataDir()
    const taskDirectory = path.join(testWorkspacePath, 'docs')

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: recoveryEnv,
      })

      let initialBinding: Awaited<ReturnType<typeof readTaskLinkedAgentBinding>>

      try {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'task-claude-recovery',
              title: 'Claude recovery task',
              position: { x: 120, y: 140 },
              width: 460,
              height: 280,
              kind: 'task',
              task: {
                requirement: 'Verify Claude task agent resume after restart',
                status: 'todo',
                linkedAgentNodeId: null,
                lastRunAt: null,
                autoGeneratedTitle: false,
                createdAt: '2026-03-08T00:00:00.000Z',
                updatedAt: '2026-03-08T00:00:00.000Z',
              },
            },
          ],
          {
            settings: {
              defaultProvider: 'claude-code',
              customModelEnabledByProvider: {
                'claude-code': false,
                codex: false,
                opencode: false,
                gemini: false,
              },
              customModelByProvider: {
                'claude-code': '',
                codex: '',
                opencode: '',
                gemini: '',
              },
              customModelOptionsByProvider: {
                'claude-code': [],
                codex: [],
                opencode: [],
                gemini: [],
              },
            },
            spaces: [
              {
                id: 'space-claude',
                name: 'docs',
                directoryPath: taskDirectory,
                nodeIds: ['task-claude-recovery'],
                rect: null,
              },
            ],
          },
        )

        await expect(window.locator('.task-node')).toHaveCount(1)
        await window.locator('.task-node [data-testid="task-node-run-agent"]').click()
        await expect(window.locator('.terminal-node')).toHaveCount(1)

        await expect
          .poll(async () => {
            const binding = await readTaskLinkedAgentBinding(window)
            return (
              typeof binding.linkedAgentNodeId === 'string' &&
              binding.linkedAgentNodeId.length > 0 &&
              binding.resumeSessionIdVerified === true &&
              typeof binding.resumeSessionId === 'string' &&
              binding.resumeSessionId.length > 0
            )
          })
          .toBe(true)

        initialBinding = await readTaskLinkedAgentBinding(window)
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: recoveryEnv,
      })

      try {
        const terminalNode = restartedWindow.locator('.terminal-node').first()
        await expect(restartedWindow.locator('.task-node')).toHaveCount(1, { timeout: 30_000 })
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1, { timeout: 30_000 })
        await expect(terminalNode).toContainText('[opencove-test-agent] claude-code resume', {
          timeout: 20_000,
        })

        await expect
          .poll(async () => {
            const binding = await readTaskLinkedAgentBinding(restartedWindow)
            return (
              binding.linkedAgentNodeId === initialBinding.linkedAgentNodeId &&
              binding.resumeSessionId === initialBinding.resumeSessionId &&
              binding.resumeSessionIdVerified === initialBinding.resumeSessionIdVerified
            )
          })
          .toBe(true)

        await expect
          .poll(async () => {
            const geometry = await readFirstAgentGeometry(restartedWindow)
            return (
              geometry.terminalSize !== null &&
              geometry.snapshotSize !== null &&
              geometry.terminalSize.cols === geometry.snapshotSize.cols &&
              geometry.terminalSize.rows === geometry.snapshotSize.rows &&
              (geometry.horizontalOverflowPx ?? Number.POSITIVE_INFINITY) <= 2 &&
              (geometry.verticalOverflowPx ?? Number.POSITIVE_INFINITY) <= 2
            )
          })
          .toBe(true)
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
