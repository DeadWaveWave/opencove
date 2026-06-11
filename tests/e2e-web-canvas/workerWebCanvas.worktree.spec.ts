import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  buildAppState,
  createWorkspaceDir,
  invokeValue,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

const execFileAsync = promisify(execFile)

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function pathAliases(value: string): string[] {
  const normalized = normalizePath(value)
  const aliases = new Set<string>([normalized])

  if (normalized.startsWith('/var/')) {
    aliases.add(`/private${normalized}`)
  } else if (normalized.startsWith('/private/var/')) {
    aliases.add(normalized.slice('/private'.length))
  }

  return [...aliases]
}

function pathMatches(actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && pathAliases(expected).includes(normalizePath(actual))
}

function pathHashCandidates(value: string): string[] {
  return pathAliases(value).map(candidate =>
    createHash('sha1').update(candidate).digest('hex').slice(0, 12),
  )
}

function buildNodeEvalCommand(source: string): string {
  return `node -e ${JSON.stringify(source)}`
}

async function runGit(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, {
    cwd,
    env: process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  })
}

async function initRepo(repoPath: string): Promise<void> {
  await runGit(['init'], repoPath)
  await runGit(['config', 'user.email', 'test@example.com'], repoPath)
  await runGit(['config', 'user.name', 'OpenCove Web E2E'], repoPath)
  await runGit(['config', 'core.autocrlf', 'false'], repoPath)
  await runGit(['config', 'core.safecrlf', 'false'], repoPath)
  await writeFile(path.join(repoPath, 'README.md'), '# web worktree\n', 'utf8')
  await runGit(['add', '.'], repoPath)
  await runGit(['commit', '-m', 'init'], repoPath)
}

async function resolveSpaceContextMenuPosition(
  page: import('@playwright/test').Page,
  spaceId: string,
): Promise<{ x: number; y: number }> {
  const pane = page.locator('.workspace-canvas .react-flow__pane')
  await expect(pane).toBeVisible()

  return await pane.evaluate((paneEl, targetSpaceId) => {
    const paneRect = paneEl.getBoundingClientRect()
    const anchor =
      document.querySelector(`[data-testid="workspace-space-files-${targetSpaceId}"]`) ??
      document.querySelector(`[data-testid="workspace-space-menu-${targetSpaceId}"]`)
    const spaceEl = anchor?.closest('.workspace-space-region') ?? null

    if (!spaceEl) {
      throw new Error(`Space region not found: ${targetSpaceId}`)
    }

    const spaceRect = spaceEl.getBoundingClientRect()
    const blocks = Array.from(
      document.querySelectorAll(
        '.terminal-node, .task-node, .note-node, .website-node, .document-node, .workspace-space-region__label-group',
      ),
    ).map(element => element.getBoundingClientRect())

    const marginX = 48
    const marginY = 64
    const candidates = [
      { x: spaceRect.left + marginX, y: spaceRect.top + marginY },
      { x: spaceRect.right - marginX, y: spaceRect.top + marginY },
      { x: spaceRect.left + marginX, y: spaceRect.bottom - marginY },
      { x: spaceRect.right - marginX, y: spaceRect.bottom - marginY },
      { x: (spaceRect.left + spaceRect.right) / 2, y: spaceRect.bottom - marginY },
      { x: spaceRect.left + marginX, y: (spaceRect.top + spaceRect.bottom) / 2 },
      { x: (spaceRect.left + spaceRect.right) / 2, y: (spaceRect.top + spaceRect.bottom) / 2 },
    ]

    const isBlocked = (x: number, y: number): boolean =>
      blocks.some(rect => x >= rect.x && x <= rect.right && y >= rect.y && y <= rect.bottom)

    for (const point of candidates) {
      if (
        point.x <= paneRect.left ||
        point.x >= paneRect.right ||
        point.y <= paneRect.top ||
        point.y >= paneRect.bottom
      ) {
        continue
      }

      if (!isBlocked(point.x, point.y)) {
        return { x: point.x - paneRect.left, y: point.y - paneRect.top }
      }
    }

    throw new Error(`No unblocked context-menu point found in Space: ${targetSpaceId}`)
  }, spaceId)
}

async function openSpaceContextMenu(
  page: import('@playwright/test').Page,
  spaceId: string,
): Promise<void> {
  const pane = page.locator('.workspace-canvas .react-flow__pane')
  const position = await resolveSpaceContextMenuPosition(page, spaceId)
  await pane.click({ button: 'right', position, force: true })
}

async function waitForWorktreeDirectory(
  page: import('@playwright/test').Page,
  options: { spaceId: string; canonicalRepoPath: string },
): Promise<string> {
  await expect
    .poll(
      async () => {
        const shared = await readSharedState(page.request)
        const space =
          shared.state?.workspaces[0]?.spaces.find(item => item.id === options.spaceId) ?? null
        const directoryPath = space?.directoryPath
        if (typeof directoryPath !== 'string') {
          return false
        }

        const canonicalDirectoryPath = await realpath(directoryPath).catch(() => directoryPath)
        const expectedWorktreesRoot = normalizePath(
          path.join(options.canonicalRepoPath, '.opencove', 'worktrees'),
        )
        const normalized = normalizePath(canonicalDirectoryPath)

        return (
          normalized !== normalizePath(options.canonicalRepoPath) &&
          normalized.startsWith(`${expectedWorktreesRoot}/`)
        )
      },
      { timeout: 30_000 },
    )
    .toBe(true)

  const shared = await readSharedState(page.request)
  const space =
    shared.state?.workspaces[0]?.spaces.find(item => item.id === options.spaceId) ?? null
  const directoryPath = space?.directoryPath
  if (typeof directoryPath !== 'string') {
    throw new Error(`Worktree directory missing for Space: ${options.spaceId}`)
  }

  return directoryPath
}

test.describe('Worker web canvas - Worktree', () => {
  test('creates a space worktree from the web UI', async ({ page }) => {
    const repoPath = await createWorkspaceDir('web-worktree')
    const canonicalRepoPath = await realpath(repoPath).catch(() => repoPath)
    await initRepo(repoPath)
    await invokeValue<void>(page.request, 'command', 'workspace.approveRoot', { path: repoPath })

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath: repoPath,
        workspaceName: 'web-worktree',
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: repoPath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    await page.locator('[data-testid="workspace-space-menu-space-1"]').click()
    await expect(page.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
    await page.locator('[data-testid="workspace-space-action-create"]').click()

    await expect(page.locator('[data-testid="space-worktree-window"]')).toBeVisible()

    const branchName = `feature/web-e2e-${Date.now()}`
    await page.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
    await expect(page.locator('[data-testid="space-worktree-create"]')).toBeEnabled()
    await page.locator('[data-testid="space-worktree-create"]').click()

    const expectedWorktreesRoot = normalizePath(
      path.join(canonicalRepoPath, '.opencove', 'worktrees'),
    )

    await expect(page.locator('[data-testid="workspace-space-switch-space-1"]')).toContainText(
      branchName,
      {
        timeout: 30_000,
      },
    )

    await expect
      .poll(
        async () => {
          const shared = await readSharedState(page.request)
          const space =
            shared.state?.workspaces[0]?.spaces.find(item => item.id === 'space-1') ?? null
          const directoryPath = space?.directoryPath
          if (typeof directoryPath !== 'string') {
            return false
          }

          const canonicalDirectoryPath = await realpath(directoryPath).catch(() => directoryPath)

          const normalized = normalizePath(canonicalDirectoryPath)
          return (
            normalized !== normalizePath(canonicalRepoPath) &&
            normalized.startsWith(`${expectedWorktreesRoot}/`)
          )
        },
        { timeout: 30_000 },
      )
      .toBe(true)
  })

  test('launches terminal and agent inside a space worktree from the web UI', async ({ page }) => {
    const spaceId = 'space-1'
    const repoPath = await createWorkspaceDir('web-worktree-runtime')
    const canonicalRepoPath = await realpath(repoPath).catch(() => repoPath)
    await initRepo(repoPath)
    await invokeValue<void>(page.request, 'command', 'workspace.approveRoot', { path: repoPath })

    await writeAppState(
      page.request,
      buildAppState({
        workspacePath: repoPath,
        workspaceName: 'web-worktree-runtime',
        spaces: [
          {
            id: spaceId,
            name: 'Main',
            directoryPath: repoPath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
        settings: {
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
        },
      }),
    )

    await openAuthedCanvas(page)

    await page.locator(`[data-testid="workspace-space-menu-${spaceId}"]`).click({ force: true })
    await expect(page.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
    await page.locator('[data-testid="workspace-space-action-create"]').click()
    await expect(page.locator('[data-testid="space-worktree-window"]')).toBeVisible()

    const branchName = `feature/web-runtime-${Date.now()}`
    await page.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
    await expect(page.locator('[data-testid="space-worktree-create"]')).toBeEnabled()
    await page.locator('[data-testid="space-worktree-create"]').click()

    await expect(page.locator(`[data-testid="workspace-space-switch-${spaceId}"]`)).toContainText(
      branchName,
      { timeout: 30_000 },
    )

    const worktreePath = await waitForWorktreeDirectory(page, { spaceId, canonicalRepoPath })
    const canonicalWorktreePath = await realpath(worktreePath).catch(() => worktreePath)

    const terminalCountBefore = await page.locator('.terminal-node').count()
    await openSpaceContextMenu(page, spaceId)
    await page.locator('[data-testid="workspace-context-new-terminal"]').click()

    await expect(page.locator('.terminal-node')).toHaveCount(terminalCountBefore + 1)
    const terminal = page.locator('.terminal-node').nth(terminalCountBefore)
    await expect(terminal.locator('.xterm')).toBeVisible()
    await terminal.locator('.xterm').click()
    await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

    const cwdToken = `OPENCOVE_WEB_WORKTREE_TERMINAL_CWD_${Date.now()}:`
    await page.keyboard.type(
      buildNodeEvalCommand(
        `const crypto = require('crypto');` +
          `const cwd = process.cwd().replace(/[\\\\/]+$/, '');` +
          `const digest = crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);` +
          `process.stdout.write(${JSON.stringify(cwdToken)} + digest + '\\n');`,
      ),
    )
    await page.keyboard.press('Enter')

    const expectedCwdHashes = pathHashCandidates(canonicalWorktreePath)
    await expect
      .poll(async () => {
        const text = (await terminal.textContent()) ?? ''
        return text.includes(cwdToken)
      })
      .toBe(true)

    await expect
      .poll(async () => {
        const shared = await readSharedState(page.request)
        const workspace = shared.state?.workspaces[0] ?? null
        const space = workspace?.spaces.find(item => item.id === spaceId) ?? null
        const terminalNode =
          workspace?.nodes.find(node => {
            const nodeId = typeof node.id === 'string' ? node.id : ''
            return node.kind === 'terminal' && space?.nodeIds.includes(nodeId)
          }) ?? null

        return {
          spaceStillUsesWorktreeDirectory: space
            ? pathMatches(space.directoryPath, worktreePath)
            : false,
          terminalBelongsToSpace: Boolean(terminalNode),
        }
      })
      .toEqual({
        spaceStillUsesWorktreeDirectory: true,
        terminalBelongsToSpace: true,
      })

    await openSpaceContextMenu(page, spaceId)
    await page.locator('[data-testid="workspace-context-run-default-agent"]').click()

    const agentTerminal = page.locator('.terminal-node', {
      hasText: '[opencove-test-agent] codex new',
    })
    await expect(agentTerminal).toBeVisible()

    await expect
      .poll(async () => {
        const terminalText = (await terminal.textContent()) ?? ''
        const shared = await readSharedState(page.request)
        const workspace = shared.state?.workspaces[0] ?? null
        const space = workspace?.spaces.find(item => item.id === spaceId) ?? null
        const terminalNode =
          workspace?.nodes.find(node => {
            const nodeId = typeof node.id === 'string' ? node.id : ''
            return node.kind === 'terminal' && space?.nodeIds.includes(nodeId)
          }) ?? null
        const agentNode =
          workspace?.nodes.find(node => {
            const nodeId = typeof node.id === 'string' ? node.id : ''
            return node.kind === 'agent' && space?.nodeIds.includes(nodeId)
          }) ?? null
        const agent = agentNode?.agent as
          | { executionDirectory?: unknown; expectedDirectory?: unknown }
          | undefined

        return {
          spaceStillUsesWorktreeDirectory: space
            ? pathMatches(space.directoryPath, worktreePath)
            : false,
          terminalCwdMatchesWorktree: expectedCwdHashes.some(hash =>
            terminalText.includes(`${cwdToken}${hash}`),
          ),
          terminalBelongsToSpace: Boolean(terminalNode),
          terminalExecutionDirectory: terminalNode
            ? pathMatches(terminalNode.executionDirectory, worktreePath)
            : false,
          terminalExpectedDirectory: terminalNode
            ? pathMatches(terminalNode.expectedDirectory, worktreePath)
            : false,
          agentBelongsToSpace: Boolean(agentNode),
          agentExecutionDirectory: agent
            ? pathMatches(agent.executionDirectory, worktreePath)
            : false,
          agentExpectedDirectory: agent
            ? pathMatches(agent.expectedDirectory, worktreePath)
            : false,
        }
      })
      .toEqual({
        spaceStillUsesWorktreeDirectory: true,
        terminalCwdMatchesWorktree: true,
        terminalBelongsToSpace: true,
        terminalExecutionDirectory: true,
        terminalExpectedDirectory: true,
        agentBelongsToSpace: true,
        agentExecutionDirectory: true,
        agentExpectedDirectory: true,
      })

    await page.locator(`[data-testid="workspace-space-menu-${spaceId}"]`).evaluate(element => {
      ;(element as HTMLElement).click()
    })
    await expect(page.locator('[data-testid="workspace-space-action-menu"]')).toBeVisible()
    await page.locator('[data-testid="workspace-space-action-archive"]').click()
    await expect(page.locator('[data-testid="space-worktree-archive-view"]')).toBeVisible()
    await expect(page.locator('[data-testid="space-worktree-status"]')).toContainText(branchName)
    await expect(page.locator('.workspace-space-worktree__error')).toHaveCount(0)
    await page.locator('[data-testid="space-worktree-archive-cancel"]').click()
  })
})
