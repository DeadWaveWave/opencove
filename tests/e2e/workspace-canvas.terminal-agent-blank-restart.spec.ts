import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  expectOverlayStubReady,
  readPersistedTerminalAgentNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

test.describe('Workspace Canvas - blank terminal agent restart', () => {
  test.skip(process.platform === 'win32', 'POSIX command shim coverage')

  test('does not relaunch a provider without a verified SessionStart identity', async () => {
    const userDataDir = await createTestUserDataDir()
    const invocationLogPath = path.join(userDataDir, 'agent-command-invocations.log')
    const commandDirectory = await createAgentCommandPath({
      invocationLogPath,
      scenario: 'jsonl-stdin-submit-turn-lifecycle',
    })
    await mkdir(testWorkspacePath, { recursive: true })
    const env = {
      PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
    }

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
        env,
      })

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'workspace-blank-restart',
          workspaces: [
            {
              id: 'workspace-blank-restart',
              name: 'workspace-blank-restart',
              path: testWorkspacePath,
              activeSpaceId: null,
              nodes: [
                {
                  id: 'terminal-blank-restart',
                  title: 'Blank agent terminal',
                  position: { x: 180, y: 160 },
                  width: 520,
                  height: 400,
                  kind: 'terminal',
                  executionDirectory: testWorkspacePath,
                },
              ],
              spaces: [],
            },
          ],
        })

        const terminal = window.locator('[data-id="terminal-blank-restart"] .terminal-node')
        await expect(terminal).toBeVisible()
        await expect.poll(() => readRuntimeSessionId(window, 'terminal-blank-restart')).toBeTruthy()
        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.type('codex')
        await window.keyboard.press('Enter')
        await expectOverlayStubReady(terminal, 'codex')
        await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
        await expect
          .poll(() => readPersistedTerminalAgentNode(window, 'terminal-blank-restart'))
          .toMatchObject({
            terminalProviderHint: 'codex',
            agent: null,
          })
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
        env,
      })

      try {
        const restoredTerminal = restartedWindow.locator(
          '[data-id="terminal-blank-restart"] .terminal-node',
        )
        await expect(restoredTerminal).toBeVisible()
        await expect(restoredTerminal.locator('.terminal-node__error')).toHaveCount(0)
        await expect(restoredTerminal.locator('.terminal-node__status')).toHaveCount(0)
        await expect
          .poll(async () => {
            const invocations = (await readFile(invocationLogPath, 'utf8'))
              .split(/\r?\n/)
              .map(line => line.trim())
            return invocations.filter(line => line.startsWith('codex ')).length
          })
          .toBe(1)
        await expect
          .poll(() => readPersistedTerminalAgentNode(restartedWindow, 'terminal-blank-restart'))
          .toMatchObject({ agent: null })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await rm(commandDirectory, { recursive: true, force: true })
      await removePathWithRetry(userDataDir)
    }
  })
})
