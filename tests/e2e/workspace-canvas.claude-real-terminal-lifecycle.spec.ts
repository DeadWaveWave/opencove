import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import type { ListTerminalAgentActivityMetadataResult } from '../../src/shared/contracts/dto'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createTestUserDataDir } from './workspace-canvas.testUtils'
import {
  readPersistedTerminalAgentNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

// Opt-in local acceptance: actual installed Claude, isolated config, no model credentials/calls.
// Run with OPENCOVE_TEST_USE_REAL_AGENTS=1 pnpm test:e2e <this file>.
test.describe('Workspace Canvas - real Claude terminal lifecycle', () => {
  test.skip(process.env.OPENCOVE_TEST_USE_REAL_AGENTS !== '1', 'Requires installed real Claude CLI')
  test.skip(process.platform === 'win32', 'POSIX interactive-shell acceptance')

  for (const exitMethod of ['ctrl-c', 'slash-exit'] as const) {
    test(`starts idle and drops all Agent chrome after ${exitMethod}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const version = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 })
      await testInfo.attach('real-cli-version', {
        body: Buffer.from(version),
        contentType: 'text/plain',
      })
      const userDataDir = await createTestUserDataDir()
      const home = path.join(userDataDir, 'home')
      const config = path.join(home, '.claude')
      const cwd = await mkdtemp(path.join(testWorkspacePath, 'real-claude-lifecycle-'))
      const diagnosticKey = 'opencove-local-diagnostic-not-a-real-key'
      await mkdir(config, { recursive: true })
      await writeFile(
        path.join(config, '.claude.json'),
        JSON.stringify({
          hasCompletedOnboarding: true,
          customApiKeyResponses: { approved: [diagnosticKey.slice(-20)], rejected: [] },
          projects: { [cwd]: { hasTrustDialogAccepted: true } },
        }),
      )
      const { electronApp, window } = await launchApp({
        userDataDir,
        env: {
          OPENCOVE_TEST_USE_REAL_AGENTS: '1',
          OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
          OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
          ANTHROPIC_API_KEY: diagnosticKey,
          ANTHROPIC_AUTH_TOKEN: '',
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
          CLAUDE_CONFIG_DIR: config,
          ZDOTDIR: home,
          SHELL: '/bin/bash',
          DISABLE_AUTOUPDATER: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
      })
      const nodeId = 'real-claude-terminal'
      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: 'real-claude',
          workspaces: [
            {
              id: 'real-claude',
              name: 'Real Claude',
              path: testWorkspacePath,
              activeSpaceId: null,
              spaces: [],
              nodes: [
                {
                  id: nodeId,
                  title: 'Terminal',
                  kind: 'terminal',
                  executionDirectory: cwd,
                  position: { x: 100, y: 80 },
                  width: 850,
                  height: 550,
                },
              ],
            },
          ],
        })
        const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
        const status = terminal.locator('.terminal-node__status')
        const sidebar = window.getByTestId(`workspace-agent-item-real-claude-${nodeId}`)
        await expect.poll(() => readRuntimeSessionId(window, nodeId)).not.toBeNull()
        const sessionId = await readRuntimeSessionId(window, nodeId)
        const activity = async () =>
          (
            await window.evaluate(() =>
              window.opencoveApi.controlSurface.invoke<ListTerminalAgentActivityMetadataResult>({
                kind: 'query',
                id: 'session.terminalAgentActivity.list',
                payload: null,
              }),
            )
          ).entries.find(entry => entry.sessionId === sessionId)
        const start = async (generation: number) => {
          await terminal.locator('.xterm-helper-textarea').click()
          await window.keyboard.type('claude')
          await window.keyboard.press('Enter')
          await expect.poll(activity).toMatchObject({
            terminalAgentActivity: {
              phase: 'active',
              generation,
              identityAuthority: 'provider_session_start',
            },
          })
          await expect(terminal.locator('.terminal-node__transcript')).toContainText('Claude Code')
          await expect(status).toHaveText('Standby')
          await expect(sidebar).toContainText('Standby')
          await expect(terminal.getByTestId('terminal-node-reload-session')).toBeVisible()
        }
        await start(1)
        const resumeSessionId = (await activity())?.resumeSessionId
        expect(resumeSessionId).toBeTruthy()
        await expect
          .poll(async () => (await readPersistedTerminalAgentNode(window, nodeId))?.agent)
          .toMatchObject({ resumeSessionId, resumeSessionIdVerified: true })
        await terminal.screenshot({ path: testInfo.outputPath('claude-real-idle.png') })
        await window.reload({ waitUntil: 'domcontentloaded' })
        await expect(status).toHaveText('Standby')
        await terminal.locator('.xterm-helper-textarea').click()
        if (exitMethod === 'ctrl-c') {
          await window.keyboard.press('Control+C')
          await expect(terminal.locator('.terminal-node__transcript')).toContainText(
            'Press Ctrl-C again to exit',
          )
          await expect(status).toHaveText('Standby')
          await window.keyboard.press('Control+C')
        } else {
          await window.keyboard.type('/exit')
          await window.keyboard.press('Enter')
        }
        await expect.poll(activity).toMatchObject({ terminalAgentActivity: { phase: 'exited' } })
        await expectPlainTerminal(terminal, sidebar)
        await window.keyboard.type("printf '\\n%s\\n' REAL_CLAUDE_SHELL_USABLE")
        await window.keyboard.press('Enter')
        await expect
          .poll(async () =>
            (await terminal.locator('.terminal-node__transcript').textContent())
              ?.split(/\r?\n/u)
              .map(line => line.trim()),
          )
          .toContain('REAL_CLAUDE_SHELL_USABLE')
        await window.reload({ waitUntil: 'domcontentloaded' })
        await expectPlainTerminal(terminal, sidebar)
        expect(await readRuntimeSessionId(window, nodeId)).toBe(sessionId)
        expect((await readPersistedTerminalAgentNode(window, nodeId))?.agent).toMatchObject({
          resumeSessionId,
          resumeSessionIdVerified: true,
        })
        await testInfo.attach('real-claude-exited', {
          body: await terminal.screenshot({ path: testInfo.outputPath('claude-real-exited.png') }),
          contentType: 'image/png',
        })
        await start(2)
        expect(await readRuntimeSessionId(window, nodeId)).toBe(sessionId)
      } finally {
        await electronApp.close()
        await rm(cwd, { recursive: true, force: true })
      }
    })
  }
})

async function expectPlainTerminal(terminal: Locator, sidebar: Locator): Promise<void> {
  await expect(terminal.locator('.terminal-node__status')).toHaveCount(0)
  await expect(sidebar).toHaveCount(0)
  await Promise.all(
    ['copy-last-message', 'reload-session', 'session-list'].map(action =>
      expect(terminal.getByTestId(`terminal-node-${action}`)).toHaveCount(0),
    ),
  )
}
