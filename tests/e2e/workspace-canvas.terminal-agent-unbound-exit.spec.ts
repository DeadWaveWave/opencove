import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import {
  createAgentCommandPath,
  readPersistedTerminalAgentNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

test.describe('Workspace Canvas - unbound terminal Agent exit', () => {
  test.skip(process.platform === 'win32', 'POSIX command shim coverage')

  for (const provider of ['claude-code', 'codex'] as const) {
    test(`${provider} drops all Agent chrome only on actual exit and can reenter`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const command = provider === 'claude-code' ? 'claude' : 'codex'
      const commandDirectory = await createAgentCommandPath({
        scenario: 'jsonl-two-stage-ctrl-c-unbound',
      })
      await mkdir(testWorkspacePath, { recursive: true })
      const executionDirectory = await mkdtemp(path.join(testWorkspacePath, 'unbound-agent-exit-'))
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        env: {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        },
      })
      const workspaceId = `workspace-unbound-${command}`
      const nodeId = `terminal-unbound-${command}`
      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: workspaceId,
          workspaces: [
            {
              id: workspaceId,
              name: workspaceId,
              path: testWorkspacePath,
              activeSpaceId: null,
              nodes: [
                {
                  id: nodeId,
                  title: 'Terminal',
                  position: { x: 180, y: 160 },
                  width: 520,
                  height: 400,
                  kind: 'terminal',
                  executionDirectory,
                },
              ],
              spaces: [],
            },
          ],
        })
        const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
        const sidebar = window.getByTestId(`workspace-agent-item-${workspaceId}-${nodeId}`)
        const transcript = async () =>
          (await terminal.locator('.terminal-node__transcript').textContent()) ?? ''
        const status = terminal.locator('.terminal-node__status')
        await expect.poll(() => readRuntimeSessionId(window, nodeId)).not.toBeNull()
        const sessionId = await readRuntimeSessionId(window, nodeId)

        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.type(command)
        await window.keyboard.press('Enter')
        await expect.poll(transcript).toContain(`[opencove-test-2c] ${provider} ready`)
        await expect(status).toHaveText('Working')
        await expect(sidebar).toContainText('Working')
        await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
        expect((await readPersistedTerminalAgentNode(window, nodeId))?.agent).toBeNull()

        await window.keyboard.press('Control+C')
        await expect.poll(transcript).toContain(`${provider} cancel-alt-exit`)
        await expect(status).toHaveText('Working')
        await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()

        await window.keyboard.press('Control+C')
        await expect.poll(transcript).toContain(`${provider} provider-exit`)
        await expect(status).toHaveCount(0)
        await expect(sidebar).toHaveCount(0)
        await Promise.all(
          ['copy-last-message', 'reload-session', 'session-list'].map(action =>
            expect(terminal.getByTestId(`terminal-node-${action}`)).toHaveCount(0),
          ),
        )
        await window.reload({ waitUntil: 'domcontentloaded' })
        await expect(terminal).toBeVisible()
        await expect(status).toHaveCount(0)
        await expect(sidebar).toHaveCount(0)
        expect(await readRuntimeSessionId(window, nodeId)).toBe(sessionId)
        expect((await readPersistedTerminalAgentNode(window, nodeId))?.agent).toBeNull()

        await terminal.locator('.xterm-helper-textarea').click()
        await window.keyboard.type("printf '\\n%s\\n' 'shell-still-usable'")
        await window.keyboard.press('Enter')
        await expect
          .poll(async () => (await transcript()).split(/\r?\n/u).map(line => line.trim()))
          .toContain('shell-still-usable')
        await testInfo.attach(`${provider}-exited-plain-terminal`, {
          body: await terminal.screenshot({ path: testInfo.outputPath(`${provider}-exit.png`) }),
          contentType: 'image/png',
        })

        await window.keyboard.type(command)
        await window.keyboard.press('Enter')
        await expect(status).toHaveText('Working')
        await expect(sidebar).toContainText('Working')
        await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
        expect(await readRuntimeSessionId(window, nodeId)).toBe(sessionId)
      } finally {
        await electronApp.close()
        await rm(commandDirectory, { recursive: true, force: true })
        await rm(executionDirectory, { recursive: true, force: true })
      }
    })
  }
})
