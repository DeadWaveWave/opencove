import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const OPENCODE_DISCOVERY_TIMEOUT_MS = 45_000

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

async function readTaskLinkedAgentInfo(window: Page): Promise<{
  linkedAgentNodeId: string | null
  sessionId: string | null
  resumeSessionId: string | null
  resumeSessionIdVerified: boolean
}> {
  const parsed = (await readWorkspaceStateRaw(window)) as {
    workspaces?: Array<{
      nodes?: Array<{
        id?: string
        kind?: string
        sessionId?: string
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
    sessionId:
      typeof agent?.sessionId === 'string' && agent.sessionId.trim().length > 0
        ? agent.sessionId
        : null,
    resumeSessionId: agent?.agent?.resumeSessionId ?? null,
    resumeSessionIdVerified: agent?.agent?.resumeSessionIdVerified ?? false,
  }
}

async function readRestoredTerminalGeometry(
  window: Page,
  nodeId: string,
  sessionId: string,
): Promise<{
  terminalSize: { cols: number; rows: number } | null
  snapshotSize: { cols: number; rows: number } | null
  horizontalGapPx: number | null
  verticalGapPx: number | null
  cellWidthPx: number | null
  cellHeightPx: number | null
} | null> {
  return await window.evaluate(
    async payload => {
      const terminalSize =
        window.__opencoveTerminalSelectionTestApi?.getSize(payload.nodeId) ?? null
      const metrics =
        window.__opencoveTerminalSelectionTestApi?.getRenderMetrics?.(payload.nodeId) ?? null
      const snapshot =
        typeof window.opencoveApi.pty.presentationSnapshot === 'function'
          ? await window.opencoveApi.pty
              .presentationSnapshot({ sessionId: payload.sessionId })
              .catch(() => null)
          : null
      const container = document.querySelector('.terminal-node__terminal')
      if (!(container instanceof HTMLElement)) {
        return null
      }

      const screen =
        container.querySelector('.xterm-screen canvas') ?? container.querySelector('.xterm-screen')
      const screenRect = screen instanceof HTMLElement ? screen.getBoundingClientRect() : null
      const contentWidth =
        terminalSize && metrics?.cssCellWidth && metrics.cssCellWidth > 0
          ? terminalSize.cols * metrics.cssCellWidth
          : metrics?.cssCanvasWidth && metrics.cssCanvasWidth > 0
            ? metrics.cssCanvasWidth
            : (screenRect?.width ?? null)
      const contentHeight =
        terminalSize && metrics?.cssCellHeight && metrics.cssCellHeight > 0
          ? terminalSize.rows * metrics.cssCellHeight
          : metrics?.cssCanvasHeight && metrics.cssCanvasHeight > 0
            ? metrics.cssCanvasHeight
            : (screenRect?.height ?? null)
      const cellWidthPx =
        metrics?.cssCellWidth && metrics.cssCellWidth > 0
          ? metrics.cssCellWidth
          : terminalSize && contentWidth
            ? contentWidth / Math.max(1, terminalSize.cols)
            : null
      const cellHeightPx =
        metrics?.cssCellHeight && metrics.cssCellHeight > 0
          ? metrics.cssCellHeight
          : terminalSize && contentHeight
            ? contentHeight / Math.max(1, terminalSize.rows)
            : null

      return {
        terminalSize,
        snapshotSize: snapshot ? { cols: snapshot.cols, rows: snapshot.rows } : null,
        horizontalGapPx: contentWidth === null ? null : container.clientWidth - contentWidth,
        verticalGapPx: contentHeight === null ? null : container.clientHeight - contentHeight,
        cellWidthPx,
        cellHeightPx,
      }
    },
    { nodeId, sessionId },
  )
}

function hasConvergedRestoredTerminalGeometry(
  geometry: Awaited<ReturnType<typeof readRestoredTerminalGeometry>>,
): boolean {
  if (!geometry?.terminalSize || !geometry.snapshotSize) {
    return false
  }

  if (
    geometry.terminalSize.cols !== geometry.snapshotSize.cols ||
    geometry.terminalSize.rows !== geometry.snapshotSize.rows
  ) {
    return false
  }

  if (
    geometry.horizontalGapPx === null ||
    geometry.verticalGapPx === null ||
    geometry.cellWidthPx === null ||
    geometry.cellHeightPx === null
  ) {
    return false
  }

  return (
    geometry.horizontalGapPx >= -2 &&
    geometry.verticalGapPx >= -2 &&
    geometry.horizontalGapPx <= Math.max(48, geometry.cellWidthPx * 6) &&
    geometry.verticalGapPx <= Math.max(48, geometry.cellHeightPx * 4)
  )
}

test.describe('Recovery - Agent placeholder replacement (OpenCode)', () => {
  test('replaces the durable placeholder scrollback with the resumed agent output after restart', async () => {
    const userDataDir = await createTestUserDataDir()
    const taskDirectory = path.join(testWorkspacePath, 'docs')

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env: {
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'opencode-idle-with-message',
        },
      })

      let initialAgentNodeId: string | null = null

      try {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'task-one',
              title: 'First task',
              position: { x: 120, y: 140 },
              width: 460,
              height: 280,
              kind: 'task',
              task: {
                requirement: 'Verify opencode placeholder replacement after restart',
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
              defaultProvider: 'opencode',
              customModelEnabledByProvider: {
                'claude-code': false,
                codex: false,
                opencode: true,
                gemini: false,
              },
              customModelByProvider: {
                'claude-code': '',
                codex: '',
                opencode: 'opencode-e2e-model',
                gemini: '',
              },
              customModelOptionsByProvider: {
                'claude-code': [],
                codex: [],
                opencode: ['opencode-e2e-model'],
                gemini: [],
              },
            },
            spaces: [
              {
                id: 'space-one',
                name: 'docs',
                directoryPath: taskDirectory,
                nodeIds: ['task-one'],
                rect: null,
              },
            ],
          },
        )

        await expect(window.locator('.task-node')).toHaveCount(1)
        await window.locator('.task-node [data-testid="task-node-run-agent"]').click()
        await expect(window.locator('.terminal-node')).toHaveCount(1)

        await expect
          .poll(
            async () => {
              const binding = await readTaskLinkedAgentInfo(window)
              return (
                typeof binding.linkedAgentNodeId === 'string' &&
                binding.linkedAgentNodeId.length > 0 &&
                binding.resumeSessionIdVerified === true &&
                typeof binding.resumeSessionId === 'string' &&
                binding.resumeSessionId.length > 0 &&
                typeof binding.sessionId === 'string' &&
                binding.sessionId.length > 0
              )
            },
            { timeout: OPENCODE_DISCOVERY_TIMEOUT_MS },
          )
          .toBe(true)

        const agentInfo = await readTaskLinkedAgentInfo(window)
        initialAgentNodeId = agentInfo.linkedAgentNodeId

        if (!agentInfo.linkedAgentNodeId || !agentInfo.sessionId) {
          throw new Error('Failed to resolve agent node/session identifiers')
        }

        const snapshot = await window.evaluate(
          async payload => {
            const result = await window.opencoveApi.pty.snapshot({ sessionId: payload.sessionId })
            await window.opencoveApi.persistence.writeAgentNodePlaceholderScrollback({
              nodeId: payload.nodeId,
              scrollback: result.data,
            })
            return result.data
          },
          { nodeId: agentInfo.linkedAgentNodeId, sessionId: agentInfo.sessionId },
        )

        expect(snapshot).toContain('[opencove-test-agent] opencode new')
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env: {
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'opencode-idle-with-message',
        },
      })

      try {
        await expect(restartedWindow.locator('.task-node')).toHaveCount(1, { timeout: 30_000 })
        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(1, { timeout: 30_000 })

        const terminalNode = restartedWindow.locator('.terminal-node').first()
        await expect(terminalNode).toContainText('[opencove-test-agent] opencode resume', {
          timeout: 20_000,
        })

        const transcript = terminalNode.locator('.terminal-node__transcript')
        await expect
          .poll(
            async () => {
              return (await transcript.textContent()) ?? ''
            },
            { timeout: 10_000 },
          )
          .not.toContain('[opencove-test-agent] opencode new')

        if (initialAgentNodeId) {
          const hydratedInfo = await readTaskLinkedAgentInfo(restartedWindow)
          expect(hydratedInfo.linkedAgentNodeId).toBe(initialAgentNodeId)
          expect(hydratedInfo.sessionId).not.toBeNull()

          await expect
            .poll(
              async () =>
                hasConvergedRestoredTerminalGeometry(
                  await readRestoredTerminalGeometry(
                    restartedWindow,
                    initialAgentNodeId,
                    hydratedInfo.sessionId ?? '',
                  ),
                ),
              { timeout: 15_000 },
            )
            .toBe(true)
        }
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(userDataDir)
    }
  })
})
