import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  readPersistedTerminalAgentNode,
  readRuntimeSessionId,
} from './workspace-canvas.terminal-agent-overlay.helpers'

const nodeId = 'pi-session-actions-agent'
const targetReply = 'Target Pi reply\nThe restored session is active.'

async function launchPiSessionActions() {
  const userDataDir = await createTestUserDataDir()
  const agentDirectory = path.join(userDataDir, 'home', '.pi', 'agent')
  const sessionDirectory = path.join(
    agentDirectory,
    'sessions',
    `--${testWorkspacePath.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`,
  )
  await mkdir(sessionDirectory, { recursive: true })
  const sessionFiles = {
    current: path.join(sessionDirectory, '2026-09-21T00-00-00_current.jsonl'),
    target: path.join(sessionDirectory, '2026-09-21T00-10-00_target.jsonl'),
  }
  await Promise.all(
    (['current', 'target'] as const).map(async name => {
      const timestamp = `2026-09-21T00:${name === 'current' ? '00' : '10'}:00.000Z`
      const rows = [
        { type: 'session', version: 3, id: `pi-${name}`, cwd: testWorkspacePath, timestamp },
        {
          type: 'message',
          id: `${name}-prompt`,
          parentId: null,
          timestamp,
          message: {
            role: 'user',
            content: [{ type: 'text', text: `Inspect the ${name} Pi session` }],
            timestamp: Date.parse(timestamp),
          },
        },
        {
          type: 'message',
          id: `${name}-reply`,
          parentId: `${name}-prompt`,
          timestamp,
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'Internal reasoning must not be copied.' },
              { type: 'text', text: name === 'current' ? 'Current Pi reply' : targetReply },
            ],
            stopReason: 'stop',
            timestamp: Date.parse(timestamp),
          },
        },
      ]
      await writeFile(sessionFiles[name], `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
    }),
  )
  const executable = path.join(userDataDir, 'pi')
  const fixture = path.resolve(__dirname, '../fixtures/agent/pi-lifecycle-stub.mjs')
  await writeFile(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)} "$@"\n`,
  )
  await chmod(executable, 0o755)
  const app = await launchApp({
    userDataDir,
    windowMode: 'offscreen',
    env: {
      OPENCOVE_TEST_USE_REAL_AGENTS: '1',
      OPENCOVE_TEST_PI_SESSION_DIR: sessionDirectory,
      PI_CODING_AGENT_DIR: agentDirectory,
      PI_CODING_AGENT_SESSION_DIR: path.join(agentDirectory, 'sessions'),
    },
  })
  return { ...app, executable, sessionFiles }
}

async function seedPiAgent(app: Awaited<ReturnType<typeof launchPiSessionActions>>) {
  await clearAndSeedWorkspace(
    app.window,
    [
      {
        id: nodeId,
        kind: 'agent',
        title: 'Pi session actions',
        position: { x: 180, y: 140 },
        width: 580,
        height: 420,
        status: 'standby',
        startedAt: '2026-09-21T00:00:00.000Z',
        agent: {
          provider: 'pi',
          prompt: '',
          model: null,
          effectiveModel: null,
          launchMode: 'resume',
          resumeSessionId: app.sessionFiles.current,
          resumeSessionIdVerified: true,
          executionDirectory: testWorkspacePath,
          expectedDirectory: testWorkspacePath,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
        },
      },
    ],
    {
      settings: {
        defaultProvider: 'pi',
        agentExecutablePathOverrideByProvider: { pi: app.executable },
        customModelEnabledByProvider: { pi: false },
        customModelByProvider: { pi: '' },
        customModelOptionsByProvider: { pi: [] },
      },
    },
  )
  const terminal = app.window.locator('.terminal-node').first()
  await expect(terminal).toContainText('[pi-fixture] restored pi-current')
  await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
  await expect(terminal).toHaveAttribute('data-agent-state-source', 'pi_hook')
  return terminal
}

// Controlled external Pi fixture; catalog, JSONL parsing, hooks, PTY and clipboard are real.
test.describe('Pi saved session actions', () => {
  test.skip(process.platform === 'win32', 'POSIX fixture launcher')

  test('copies the last assistant text from the bound Pi session', async () => {
    const app = await launchPiSessionActions()
    try {
      const terminal = await seedPiAgent(app)
      await app.electronApp.evaluate(({ clipboard }) => clipboard.clear())
      await terminal.getByTestId('terminal-node-copy-last-message').click()
      await expect
        .poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe('Current Pi reply')
      await terminal.screenshot({ path: test.info().outputPath('pi-copy-last-message.png') })
    } finally {
      await app.electronApp.close()
    }
  })

  test('switches in place to the exact Pi session file and copies its reply', async () => {
    const app = await launchPiSessionActions()
    const { window, electronApp, sessionFiles } = app
    try {
      const terminal = await seedPiAgent(app)
      const previousPtySessionId = await readRuntimeSessionId(window, nodeId)
      expect(previousPtySessionId).toBeTruthy()
      await window.evaluate(() => {
        const state = window as typeof window & { __piExitedPtySessionIds?: string[] }
        state.__piExitedPtySessionIds = []
        window.opencoveApi.pty.onExit(event => {
          state.__piExitedPtySessionIds?.push(event.sessionId)
        })
      })
      await terminal.getByTestId('terminal-node-session-list').click()
      const menu = window.getByTestId('terminal-node-session-menu')
      await expect(menu.locator('.terminal-node__session-menu-item')).toHaveCount(2)
      await expect(
        window.getByTestId(`terminal-node-session-menu-item-${sessionFiles.current}`),
      ).toBeDisabled()
      const target = window.getByTestId(`terminal-node-session-menu-item-${sessionFiles.target}`)
      await expect(target).toContainText('Inspect the target Pi session')
      await menu.screenshot({ path: test.info().outputPath('pi-session-menu.png') })
      await target.click()
      await window
        .getByTestId(`terminal-node-session-switch-confirm-submit-${sessionFiles.target}`)
        .click()

      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(terminal).toContainText('[pi-fixture] restored pi-target')
      await expect(terminal.locator('.terminal-node__status')).toHaveText('Standby')
      await expect.poll(() => readRuntimeSessionId(window, nodeId)).not.toBe(previousPtySessionId)
      await expect
        .poll(() =>
          window.evaluate(() => {
            return (window as typeof window & { __piExitedPtySessionIds?: string[] })
              .__piExitedPtySessionIds
          }),
        )
        .toContain(previousPtySessionId)
      await expect
        .poll(async () => {
          const node = await readPersistedTerminalAgentNode(window, nodeId)
          return node?.agent
        })
        .toMatchObject({ resumeSessionId: sessionFiles.target, resumeSessionIdVerified: true })
      await electronApp.evaluate(({ clipboard }) => clipboard.clear())
      await terminal.getByTestId('terminal-node-copy-last-message').click()
      await expect
        .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(targetReply)
      await terminal.screenshot({ path: test.info().outputPath('pi-session-switched.png') })
      await window.reload()
      await expect(terminal).toContainText('[pi-fixture] restored pi-target')
      await terminal.getByTestId('terminal-node-session-list').click()
      await expect(
        window.getByTestId(`terminal-node-session-menu-item-${sessionFiles.target}`),
      ).toBeDisabled()
      await expect(
        window.getByTestId(`terminal-node-session-menu-item-${sessionFiles.current}`),
      ).toBeEnabled()
    } finally {
      await electronApp.close()
    }
  })
})
