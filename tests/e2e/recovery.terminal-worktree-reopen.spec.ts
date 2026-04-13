import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'

async function readTerminalBoundDirectory(window: Parameters<typeof clearAndSeedWorkspace>[0]) {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        workspaces?: Array<{
          nodes?: Array<{
            id?: string
            executionDirectory?: string | null
            expectedDirectory?: string | null
          }>
          spaces?: Array<{
            id?: string
            directoryPath?: string | null
          }>
        }>
      }

      const workspace = parsed.workspaces?.[0]
      const terminal = workspace?.nodes?.find(node => node.id === 'terminal-worktree-reload')
      const space = workspace?.spaces?.find(item => item.id === 'space-worktree-reload')

      return {
        executionDirectory: terminal?.executionDirectory ?? null,
        expectedDirectory: terminal?.expectedDirectory ?? null,
        spaceDirectoryPath: space?.directoryPath ?? null,
      }
    } catch {
      return null
    }
  })
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('Recovery - Terminal worktree reopen', () => {
  test('reopens a space terminal in its bound worktree directory after app restart', async () => {
    const userDataDir = await createTestUserDataDir()
    const worktreeName = `wt-e2e-terminal-reopen-${Date.now()}`
    const worktreePath = path.join(testWorkspacePath, '.opencove', 'worktrees', worktreeName)

    await mkdir(worktreePath, { recursive: true })

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'terminal-worktree-reload',
              title: 'terminal-worktree-reload',
              position: { x: 160, y: 140 },
              width: 520,
              height: 320,
              kind: 'terminal',
              executionDirectory: worktreePath,
              expectedDirectory: worktreePath,
            },
          ],
          {
            spaces: [
              {
                id: 'space-worktree-reload',
                name: 'Worktree Reload',
                directoryPath: worktreePath,
                nodeIds: ['terminal-worktree-reload'],
                rect: { x: 120, y: 100, width: 640, height: 420 },
              },
            ],
            activeSpaceId: 'space-worktree-reload',
          },
        )

        const terminal = window.locator('.terminal-node').first()
        await expect(terminal).toBeVisible()
        await expect(terminal.locator('.xterm')).toBeVisible()

        await expect
          .poll(async () => await readTerminalBoundDirectory(window))
          .toEqual({
            executionDirectory: worktreePath,
            expectedDirectory: worktreePath,
            spaceDirectoryPath: worktreePath,
          })
      } finally {
        await electronApp.close()
      }

      const { electronApp: restartedApp, window: restartedWindow } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: true,
      })

      try {
        const cwdToken = `OPENCOVE_RESTART_CWD_${Date.now()}:`
        const restartedTerminal = restartedWindow.locator('.terminal-node').first()
        await expect(restartedTerminal).toBeVisible()
        await expect(restartedTerminal.locator('.xterm')).toBeVisible()

        await restartedTerminal.locator('.xterm').click()
        await expect(restartedTerminal.locator('.xterm-helper-textarea')).toBeFocused()
        await restartedWindow.waitForTimeout(500)
        await restartedWindow.keyboard.type(
          buildNodeEvalCommand(
            `process.stdout.write(${JSON.stringify(cwdToken)} + process.cwd() + '\\n')`,
          ),
          { delay: 20 },
        )
        await restartedWindow.keyboard.press('Enter')

        await expect
          .poll(async () => await restartedTerminal.textContent(), { timeout: 30_000 })
          .toMatch(new RegExp(`${escapeRegex(cwdToken)}[\\s\\S]*${escapeRegex(worktreeName)}`))
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removePathWithRetry(worktreePath)
      await removePathWithRetry(userDataDir)
    }
  })
})
