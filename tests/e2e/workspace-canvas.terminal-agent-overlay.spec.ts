import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

const testAgentStubScript = path.resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')

async function createAgentCommandPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'opencove-agent-overlay-'))
  const executablePath = path.join(directory, 'codex')
  await writeFile(
    executablePath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(
      testAgentStubScript,
    )} codex "$PWD" new default-model "" codex-overlay-lifecycle\n`,
    'utf8',
  )
  await chmod(executablePath, 0o755)
  return directory
}

async function readRuntimeSessionId(window: Page, nodeId: string): Promise<string | null> {
  return await window.evaluate(id => {
    return window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null
  }, nodeId)
}

async function readPersistedNode(window: Page, nodeId: string) {
  return await window.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const parsed = raw
      ? (JSON.parse(raw) as {
          workspaces?: Array<{
            nodes?: Array<{
              id: string
              kind: string
              sessionId?: string | null
              agent?: { provider?: string; resumeSessionId?: string | null } | null
              agentOverlay?: unknown
            }>
          }>
        })
      : null
    return parsed?.workspaces
      ?.flatMap(workspace => workspace.nodes ?? [])
      .find(node => node.id === id)
  }, nodeId)
}

async function runOverlayLifecycle(options: {
  window: Page
  nodeId: string
  terminal: Locator
}): Promise<void> {
  const { window, nodeId, terminal } = options
  await expect.poll(() => readRuntimeSessionId(window, nodeId), { timeout: 15_000 }).toBeTruthy()
  const initialSessionId = await readRuntimeSessionId(window, nodeId)
  expect(initialSessionId).not.toBeNull()

  await terminal.locator('.xterm-helper-textarea').click()
  await window.keyboard.type('codex')
  await window.keyboard.press('Enter')

  const sidebarItem = window.locator(
    `[data-testid="workspace-agent-item-workspace-overlay-${nodeId}"]`,
  )
  await expect(sidebarItem).toBeVisible({ timeout: 15_000 })
  await expect(sidebarItem).toContainText('Working')
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Working')
  await expect(sidebarItem).toContainText('Standby', { timeout: 15_000 })
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')

  await expect
    .poll(() => readPersistedNode(window, nodeId))
    .toMatchObject({
      id: nodeId,
      kind: 'terminal',
      sessionId: initialSessionId,
      agent: { provider: 'codex' },
    })
  const persistedDuringOverlay = await readPersistedNode(window, nodeId)
  expect(persistedDuringOverlay?.agentOverlay).toBeUndefined()
  expect(await readRuntimeSessionId(window, nodeId)).toBe(initialSessionId)

  await window.keyboard.type('claude')
  await window.keyboard.press('Enter')
  await expect(sidebarItem).toBeVisible()
  expect((await readPersistedNode(window, nodeId))?.agent?.provider).toBe('codex')

  await window.keyboard.press('Control+C')
  await expect(sidebarItem).toHaveCount(0)
  await expect
    .poll(() => readPersistedNode(window, nodeId))
    .toMatchObject({
      id: nodeId,
      kind: 'terminal',
      sessionId: initialSessionId,
      agent: null,
    })
  expect(await readRuntimeSessionId(window, nodeId)).toBe(initialSessionId)
}

test.describe('Workspace Canvas - Terminal agent overlay', () => {
  test.skip(process.platform === 'win32', 'POSIX command shim coverage')

  test('recognizes and drops back in both space-internal and root-canvas terminals', async () => {
    const commandDirectory = await createAgentCommandPath()
    await mkdir(testWorkspacePath, { recursive: true })
    const spaceExecutionDirectory = await mkdtemp(
      path.join(testWorkspacePath, 'agent-overlay-space-'),
    )
    const rootExecutionDirectory = await mkdtemp(
      path.join(testWorkspacePath, 'agent-overlay-root-'),
    )
    const { electronApp, window } = await launchApp({
      windowMode: 'offscreen',
      env: {
        PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
      },
    })

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-overlay',
        workspaces: [
          {
            id: 'workspace-overlay',
            name: 'workspace-overlay',
            path: testWorkspacePath,
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-space',
                title: 'Space terminal',
                position: { x: 180, y: 160 },
                width: 520,
                height: 400,
                kind: 'terminal',
                executionDirectory: spaceExecutionDirectory,
              },
              {
                id: 'terminal-root',
                title: 'Root terminal',
                position: { x: 820, y: 160 },
                width: 520,
                height: 400,
                kind: 'terminal',
                executionDirectory: rootExecutionDirectory,
              },
            ],
            spaces: [
              {
                id: 'space-overlay',
                name: 'Overlay space',
                directoryPath: spaceExecutionDirectory,
                nodeIds: ['terminal-space'],
                rect: { x: 120, y: 100, width: 620, height: 520 },
              },
            ],
          },
        ],
      })

      await runOverlayLifecycle({
        window,
        nodeId: 'terminal-space',
        terminal: window.locator('[data-id="terminal-space"] .terminal-node'),
      })
      await runOverlayLifecycle({
        window,
        nodeId: 'terminal-root',
        terminal: window.locator('[data-id="terminal-root"] .terminal-node'),
      })
    } finally {
      await electronApp.close()
      await rm(commandDirectory, { recursive: true, force: true })
      await rm(spaceExecutionDirectory, { recursive: true, force: true })
      await rm(rootExecutionDirectory, { recursive: true, force: true })
    }
  })
})
