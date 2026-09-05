import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { readPersistedTerminalAgentNode } from './workspace-canvas.terminal-agent-overlay.helpers'

test.skip(process.platform !== 'win32', 'Windows Codex session-file lifecycle')

test('typed Codex adopts the terminal, persists file identity, resumes exactly once, and exits to the shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'OpenCove file sessions '))
  const userDataDir = await createTestUserDataDir()
  const bin = join(root, 'bin')
  await mkdir(bin)
  const log = join(root, 'invocations.jsonl')
  await writeFile(log, '')
  const fixture = resolve('tests/e2e/fixtures/codex-session-file-provider.mjs')
  await writeFile(
    join(bin, 'codex.cmd'),
    `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  )
  const env = {
    OPENCOVE_TEST_WORKSPACE: root,
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    CODEX_HOME: join(root, 'codex-home'),
    OPENCOVE_SESSION_FILE_FIXTURE_LOG: log,
    OPENCOVE_TEST_USE_REAL_AGENTS: '1',
    OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
  }
  const nodeId = 'file-terminal'
  let resumeSessionId: string | null = null
  try {
    const first = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    try {
      await seedWorkspaceState(first.window, {
        activeWorkspaceId: 'file-workspace',
        workspaces: [
          {
            id: 'file-workspace',
            name: 'Files',
            path: root,
            activeSpaceId: null,
            spaces: [],
            nodes: [
              {
                id: nodeId,
                title: 'Terminal',
                kind: 'terminal',
                position: { x: 150, y: 130 },
                width: 640,
                height: 430,
                executionDirectory: root,
              },
            ],
          },
        ],
      })
      const node = first.window.locator(`[data-id="${nodeId}"] .terminal-node`)
      await expect(node).toContainText('PS ')
      await node.locator('.xterm-helper-textarea').focus()
      await first.window.keyboard.type('codex')
      await first.window.keyboard.press('Enter')
      await expect(node).toContainText('CODEX_FILE_READY=')
      await expect(node.getByTestId('terminal-node-session-list')).toBeVisible()
      await expect
        .poll(
          async () =>
            (await readPersistedTerminalAgentNode(first.window, nodeId))?.agent
              ?.resumeSessionIdVerified,
        )
        .toBe(true)
      resumeSessionId = (await readPersistedTerminalAgentNode(first.window, nodeId))!.agent!
        .resumeSessionId
      await node.locator('.xterm-helper-textarea').focus()
      await first.window.keyboard.type('FILE_RESTART_SENTINEL')
      await first.window.keyboard.press('Enter')
      await expect(node).toContainText('SAVED_TURN=FILE_RESTART_SENTINEL')
      await expect(node.locator('.terminal-node__status')).toHaveText('Standby')
      await expect(node).toHaveAttribute('data-agent-state-source', 'session_file')
    } finally {
      await first.electronApp.close()
    }
    expect(resumeSessionId).toBeTruthy()
    const second = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    try {
      const node = second.window.locator(`[data-id="${nodeId}"] .terminal-node`)
      await expect(node).toContainText(`CODEX_FILE_READY=${resumeSessionId}`)
      await expect(node).toContainText('RESTORED_HISTORY=')
      await expect(node).toContainText('RESTORED_TURN=FILE_RESTART_SENTINEL')
      const invocations = (await readFile(log, 'utf8'))
        .trim()
        .split(/\r?\n/)
        .map(line => JSON.parse(line) as string[])
      expect(invocations.filter(args => args.includes('resume'))).toHaveLength(1)
      expect(invocations[1]).toContain(resumeSessionId)
      await node.locator('.xterm-helper-textarea').focus()
      await second.window.keyboard.press('Control+C')
      await expect(node.getByTestId('terminal-node-session-list')).not.toBeVisible()
      await second.window.keyboard.type("Write-Output ('SHELL_' + 'STILL_WORKS')")
      await second.window.keyboard.press('Enter')
      await expect(node).toContainText('SHELL_STILL_WORKS')
      const durable = await readPersistedTerminalAgentNode(second.window, nodeId)
      expect(durable?.kind).toBe('terminal')
      expect(durable?.agent).toMatchObject({ resumeSessionId, resumeSessionIdVerified: true })
    } finally {
      await second.electronApp.close()
    }
  } finally {
    await removePathWithRetry(root)
    await removePathWithRetry(userDataDir)
  }
})
