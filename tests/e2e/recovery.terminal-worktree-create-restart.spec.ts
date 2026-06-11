import { expect, test, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
  seedWorkspaceState,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { openPaneContextMenuInSpace } from './workspace-canvas.arrange.shared'
import type { ListMountsResult } from '../../src/shared/contracts/dto'

const execFileAsync = promisify(execFile)

async function removeGitWorktree(payload: {
  branchName: string
  worktreePath: string | null
}): Promise<void> {
  if (payload.worktreePath) {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', payload.worktreePath], {
        cwd: testWorkspacePath,
      })
    } catch {
      // ignore cleanup failures
    }

    await removePathWithRetry(payload.worktreePath)
  }

  try {
    await execFileAsync('git', ['branch', '-D', payload.branchName], { cwd: testWorkspacePath })
  } catch {
    // ignore cleanup failures
  }
}

async function readWorktreeTerminalState(window: Page): Promise<{
  spaceDirectoryPath: string | null
  spaceTargetMountId: string | null
  terminalExecutionDirectory: string | null
  terminalExpectedDirectory: string | null
  terminalCount: number
  agentExecutionDirectory: string | null
  agentExpectedDirectory: string | null
  agentCount: number
} | null> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        workspaces?: Array<{
          nodes?: Array<{
            kind?: string
            executionDirectory?: string | null
            expectedDirectory?: string | null
            agent?: {
              executionDirectory?: string | null
              expectedDirectory?: string | null
            } | null
          }>
          spaces?: Array<{
            id?: string
            directoryPath?: string | null
            targetMountId?: string | null
          }>
        }>
      }
      const workspace = parsed.workspaces?.[0]
      const terminals = workspace?.nodes?.filter(node => node.kind === 'terminal') ?? []
      const terminal = terminals[0] ?? null
      const agents = workspace?.nodes?.filter(node => node.kind === 'agent') ?? []
      const agent = agents[0] ?? null
      const space = workspace?.spaces?.find(item => item.id === 'space-worktree-create-restart')

      return {
        spaceDirectoryPath: space?.directoryPath ?? null,
        spaceTargetMountId: space?.targetMountId ?? null,
        terminalExecutionDirectory: terminal?.executionDirectory ?? null,
        terminalExpectedDirectory: terminal?.expectedDirectory ?? null,
        terminalCount: terminals.length,
        agentExecutionDirectory:
          agent?.agent?.executionDirectory ?? agent?.executionDirectory ?? null,
        agentExpectedDirectory: agent?.agent?.expectedDirectory ?? agent?.expectedDirectory ?? null,
        agentCount: agents.length,
      }
    } catch {
      return null
    }
  })
}

async function overwriteSpaceTargetMountId(
  window: Page,
  payload: { spaceId: string; targetMountId: string | null },
): Promise<void> {
  const result = await window.evaluate(async ({ spaceId, targetMountId }) => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      throw new Error('Missing workspace state.')
    }

    const parsed = JSON.parse(raw) as {
      workspaces?: Array<{
        spaces?: Array<{
          id?: string
          targetMountId?: string | null
        }>
      }>
    }
    const space =
      parsed.workspaces
        ?.flatMap(workspace => workspace.spaces ?? [])
        .find(candidate => candidate.id === spaceId) ?? null
    if (!space) {
      throw new Error(`Missing space ${spaceId}.`)
    }

    space.targetMountId = targetMountId
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify(parsed),
    })
  }, payload)

  if (!result.ok) {
    throw new Error(
      `Failed to overwrite Space targetMountId: ${result.reason}: ${result.error.code}${
        result.error.debugMessage ? `: ${result.error.debugMessage}` : ''
      }`,
    )
  }
}

async function expectTerminalCwdContains(
  window: Page,
  terminal: ReturnType<Page['locator']>,
  expectedPathPart: string,
): Promise<void> {
  const cwdToken = `OPENCOVE_WORKTREE_CWD_${Date.now()}:`
  const normalizeTerminalText = (value: string | null): string => (value ?? '').replace(/\s+/g, '')
  const normalizedToken = normalizeTerminalText(cwdToken)
  const normalizedExpected = normalizeTerminalText(expectedPathPart)

  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await window.keyboard.type(
    buildNodeEvalCommand(
      `process.stdout.write(${JSON.stringify(cwdToken)} + process.cwd() + '\\n')`,
    ),
    { delay: 20 },
  )
  await window.keyboard.press('Enter')

  await expect
    .poll(async () => {
      const normalized = normalizeTerminalText(await terminal.textContent())
      const tokenIndex = normalized.indexOf(normalizedToken)
      if (tokenIndex < 0) {
        return false
      }

      return normalized.slice(tokenIndex).includes(normalizedExpected)
    })
    .toBe(true)
}

test.describe('Recovery - Terminal created after Space worktree', () => {
  test('keeps the first terminal in a newly created Space worktree after app restart', async () => {
    const userDataDir = await createTestUserDataDir()
    const branchName = `opencove-e2e-wt-terminal-${Date.now()}`
    const staleMountId = `mount-stale-${Date.now()}`
    let createdWorktreePath: string | null = null
    let mountId: string | null = null

    try {
      const { electronApp, window } = await launchApp({
        windowMode: 'offscreen',
        userDataDir,
        cleanupUserDataDir: false,
      })

      try {
        const settings = {
          defaultProvider: 'codex',
          customModelEnabledByProvider: {
            'claude-code': false,
            codex: true,
          },
          customModelByProvider: {
            'claude-code': '',
            codex: 'gpt-5.2-codex',
          },
          customModelOptionsByProvider: {
            'claude-code': [],
            codex: ['gpt-5.2-codex'],
          },
          standardWindowSizeBucket: 'regular',
        }
        const seedSpace = (targetMountId: string | null, directoryPath = testWorkspacePath) => ({
          id: 'space-worktree-create-restart',
          name: 'Worktree Create Restart',
          directoryPath,
          targetMountId,
          labelColor: null,
          nodeIds: [],
          rect: { x: 120, y: 100, width: 760, height: 480 },
        })

        await clearAndSeedWorkspace(window, [], {
          spaces: [seedSpace(null)],
          activeSpaceId: 'space-worktree-create-restart',
          settings,
        })

        const mountResult = await window.evaluate(async workspaceId => {
          return await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
            kind: 'query',
            id: 'mount.list',
            payload: { projectId: workspaceId },
          })
        }, seededWorkspaceId)
        mountId = mountResult.mounts[0]?.mountId ?? null
        expect(mountId).not.toBeNull()

        await seedWorkspaceState(window, {
          activeWorkspaceId: seededWorkspaceId,
          workspaces: [
            {
              id: seededWorkspaceId,
              name: path.basename(testWorkspacePath),
              path: testWorkspacePath,
              nodes: [],
              spaces: [seedSpace(mountId)],
              activeSpaceId: 'space-worktree-create-restart',
            },
          ],
          settings,
        })

        await window
          .locator('[data-testid="workspace-space-switch-space-worktree-create-restart"]')
          .click()
        await window
          .locator('[data-testid="workspace-space-menu-space-worktree-create-restart"]')
          .click()
        await expect(window.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
        await window.locator('[data-testid="workspace-space-action-create"]').click()

        const worktreeWindow = window.locator('[data-testid="space-worktree-window"]')
        await expect(worktreeWindow).toBeVisible()
        await worktreeWindow.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
        await worktreeWindow.locator('[data-testid="space-worktree-create"]').click()
        await expect(worktreeWindow).toHaveCount(0, { timeout: 30_000 })

        const pane = window.locator('.workspace-canvas .react-flow__pane')
        await openPaneContextMenuInSpace(window, pane, 'space-worktree-create-restart')
        await expect(window.locator('[data-testid="workspace-context-new-terminal"]')).toBeVisible()
        await window.locator('[data-testid="workspace-context-new-terminal"]').click()

        const terminal = window.locator('.terminal-node').first()
        await expect(terminal).toBeVisible()
        await expect(terminal.locator('.xterm')).toBeVisible()

        await expect
          .poll(async () => await readWorktreeTerminalState(window), { timeout: 20_000 })
          .toMatchObject({
            terminalCount: 1,
          })

        const persistedState = await readWorktreeTerminalState(window)
        createdWorktreePath = persistedState?.spaceDirectoryPath ?? null
        expect(createdWorktreePath).not.toBeNull()
        expect(createdWorktreePath).not.toBe(testWorkspacePath)
        expect(createdWorktreePath).toContain(branchName)
        expect(persistedState?.spaceTargetMountId).toBe(mountId)
        expect(persistedState?.terminalExecutionDirectory).toBe(createdWorktreePath)
        expect(persistedState?.terminalExpectedDirectory).toBe(createdWorktreePath)

        await expectTerminalCwdContains(window, terminal, path.basename(createdWorktreePath))

        await overwriteSpaceTargetMountId(window, {
          spaceId: 'space-worktree-create-restart',
          targetMountId: staleMountId,
        })
        await expect
          .poll(async () => await readWorktreeTerminalState(window), { timeout: 10_000 })
          .toMatchObject({
            spaceDirectoryPath: createdWorktreePath,
            spaceTargetMountId: staleMountId,
            terminalExecutionDirectory: createdWorktreePath,
            terminalExpectedDirectory: createdWorktreePath,
            terminalCount: 1,
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
        await expect
          .poll(async () => await readWorktreeTerminalState(restartedWindow), { timeout: 20_000 })
          .toMatchObject({
            spaceDirectoryPath: createdWorktreePath,
            terminalExecutionDirectory: createdWorktreePath,
            terminalExpectedDirectory: createdWorktreePath,
            terminalCount: 1,
          })

        const restartedTerminal = restartedWindow.locator('.terminal-node').first()
        await expect(restartedTerminal).toBeVisible()
        await expect(restartedTerminal.locator('.xterm')).toBeVisible()
        await expect(restartedTerminal.locator('.terminal-node__terminal')).toHaveAttribute(
          'aria-busy',
          'false',
        )

        await expectTerminalCwdContains(
          restartedWindow,
          restartedTerminal,
          path.basename(createdWorktreePath ?? ''),
        )

        const pane = restartedWindow.locator('.workspace-canvas .react-flow__pane')
        await openPaneContextMenuInSpace(restartedWindow, pane, 'space-worktree-create-restart')
        const runAgent = restartedWindow.locator(
          '[data-testid="workspace-context-run-default-agent"]',
        )
        await expect(runAgent).toBeVisible()
        await runAgent.click()

        await expect(restartedWindow.locator('.terminal-node')).toHaveCount(2)
        await expect(restartedWindow.locator('.terminal-node').last()).toContainText(
          '[opencove-test-agent] codex new',
        )
        await expect
          .poll(async () => await readWorktreeTerminalState(restartedWindow), { timeout: 20_000 })
          .toMatchObject({
            spaceDirectoryPath: createdWorktreePath,
            spaceTargetMountId: mountId,
            terminalExecutionDirectory: createdWorktreePath,
            terminalExpectedDirectory: createdWorktreePath,
            terminalCount: 1,
            agentExecutionDirectory: createdWorktreePath,
            agentExpectedDirectory: createdWorktreePath,
            agentCount: 1,
          })
      } finally {
        await restartedApp.close()
      }
    } finally {
      await removeGitWorktree({ branchName, worktreePath: createdWorktreePath })
      await removePathWithRetry(userDataDir)
    }
  })
})
