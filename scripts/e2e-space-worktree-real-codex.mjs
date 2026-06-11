/* eslint-disable no-await-in-loop -- real Codex replies are intentionally verified sequentially */

import { _electron as electron } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const workspaceId = 'workspace-real-codex-space-worktree'
const spaceId = 'space-real-codex-space-worktree'
const runId = Date.now()
const branchName = `opencove-real-codex-wt-${runId}`
const windowMode = process.env.OPENCOVE_E2E_WINDOW_MODE?.trim() || 'inactive'
const baseEnv = { ...process.env }
delete baseEnv.__CFBundleIdentifier
delete baseEnv.ELECTRON_RUN_AS_NODE

let createdWorktreePath = null,
  userDataDir = null

function fail(message, detail) {
  const suffix = detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function removePathWithRetry(targetPath, attempts = 20) {
  try {
    await rm(targetPath, { recursive: true, force: true })
  } catch (error) {
    const code = error?.code
    if ((code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') && attempts > 1) {
      await delay(250)
      await removePathWithRetry(targetPath, attempts - 1)
    }
  }
}

function buildNodeEvalCommand(script) {
  const encodedScript = Buffer.from(script, 'utf8').toString('base64')
  return `node -e "eval(Buffer.from('${encodedScript}','base64').toString())"`
}

async function createUserDataDir() {
  const parent = path.join(os.tmpdir(), 'opencove-real-codex-e2e')
  await mkdir(parent, { recursive: true })
  return await mkdtemp(path.join(parent, 'space-worktree-'))
}

async function launchApp() {
  userDataDir ??= await createUserDataDir()
  await writeFile(
    path.join(userDataDir, 'approved-workspaces.json'),
    `${JSON.stringify({ version: 1, roots: [repoRoot] })}\n`,
    'utf8',
  )

  const app = await electron.launch({
    timeout: 45_000,
    args:
      process.platform === 'linux' && process.env.CI
        ? ['--no-sandbox', '--disable-dev-shm-usage', repoRoot]
        : [repoRoot],
    env: {
      ...baseEnv,
      NODE_ENV: 'test',
      CODEX_HOME: baseEnv.CODEX_HOME || path.join(os.homedir(), '.codex'),
      OPENCOVE_TEST_WORKSPACE: repoRoot,
      OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
      OPENCOVE_TEST_USE_REAL_AGENTS: '1',
      OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
      OPENCOVE_TERMINAL_TEST_API: '1',
      OPENCOVE_E2E_WINDOW_MODE: windowMode,
      ...(process.platform === 'linux' && process.env.CI ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForControlSurface(page)
  return { app, page }
}

async function waitForControlSurface(page) {
  await poll(
    async () => {
      try {
        await page.evaluate(async () => {
          await window.opencoveApi.controlSurface.invoke({
            kind: 'query',
            id: 'system.ping',
            payload: null,
          })
        })
        return true
      } catch {
        return false
      }
    },
    Boolean,
    'control surface ready',
    20_000,
  )
}

async function invokeControlSurface(page, request) {
  return await page.evaluate(async requestPayload => {
    return await window.opencoveApi.controlSurface.invoke(requestPayload)
  }, request)
}

async function ensureLocalMount(page) {
  const list = await invokeControlSurface(page, {
    kind: 'query',
    id: 'mount.list',
    payload: { projectId: workspaceId },
  })
  const existing =
    list.mounts?.find(mount => mount.endpointId === 'local' && mount.rootPath === repoRoot) ?? null
  if (existing) {
    return existing.mountId
  }

  const created = await invokeControlSurface(page, {
    kind: 'command',
    id: 'mount.create',
    payload: {
      projectId: workspaceId,
      endpointId: 'local',
      rootPath: repoRoot,
      name: path.basename(repoRoot),
    },
  })
  return created.mount.mountId
}

async function seedWorkspace(page, mountId) {
  const state = {
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [
      {
        id: workspaceId,
        name: path.basename(repoRoot),
        path: repoRoot,
        spaces: [
          {
            id: spaceId,
            name: 'Real Codex Space Worktree',
            directoryPath: repoRoot,
            targetMountId: mountId,
            nodeIds: [],
            rect: { x: 120, y: 100, width: 920, height: 620 },
          },
        ],
        activeSpaceId: spaceId,
        nodes: [],
      },
    ],
    settings: {
      defaultProvider: 'codex',
      agentFullAccess: false,
    },
  }

  const result = await page.evaluate(async payload => {
    window.localStorage.removeItem('opencove:m5.6:view-state')
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify(payload),
    })
  }, state)
  if (!result.ok) {
    fail('Failed to seed workspace state', result)
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.workspace-canvas .react-flow__pane').waitFor({ state: 'visible' })
}

async function readState(page) {
  return await page.evaluate(
    async ({ targetSpaceId }) => {
      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      if (!raw) {
        return null
      }
      const parsed = JSON.parse(raw)
      const workspace = parsed.workspaces?.find(item => item.id === parsed.activeWorkspaceId)
      const space = workspace?.spaces?.find(item => item.id === targetSpaceId) ?? null
      const terminals = workspace?.nodes?.filter(node => node.kind === 'terminal') ?? []
      const agents = workspace?.nodes?.filter(node => node.kind === 'agent') ?? []
      return {
        spaceDirectoryPath: space?.directoryPath ?? null,
        terminalCount: terminals.length,
        agentCount: agents.length,
        terminalDirectories: terminals.map(node => ({
          id: node.id,
          executionDirectory: node.executionDirectory ?? null,
          expectedDirectory: node.expectedDirectory ?? null,
        })),
        agentDirectories: agents.map(node => ({
          id: node.id,
          executionDirectory: node.agent?.executionDirectory ?? node.executionDirectory ?? null,
          expectedDirectory: node.agent?.expectedDirectory ?? node.expectedDirectory ?? null,
        })),
      }
    },
    { targetSpaceId: spaceId },
  )
}

async function poll(fn, predicate, label, timeoutMs = 15_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  while (Date.now() < deadline) {
    lastValue = await fn()
    if (predicate(lastValue)) {
      return lastValue
    }
    await delay(intervalMs)
  }
  fail(`Timed out waiting for ${label}`, lastValue)
}

async function createSpaceWorktree(page) {
  await page.locator(`[data-testid="workspace-space-switch-${spaceId}"]`).click()
  await page.locator(`[data-testid="workspace-space-menu-${spaceId}"]`).click()
  await page.locator('[data-testid="workspace-space-action-create"]').waitFor({ state: 'visible' })
  await page.locator('[data-testid="workspace-space-action-create"]').click()

  const dialog = page.locator('[data-testid="space-worktree-window"]')
  await dialog.waitFor({ state: 'visible' })
  await dialog.locator('[data-testid="space-worktree-branch-name"]').fill(branchName)
  await dialog.locator('[data-testid="space-worktree-create"]').click()
  await dialog.waitFor({ state: 'detached', timeout: 45_000 })

  const state = await poll(
    async () => await readState(page),
    value =>
      !!value?.spaceDirectoryPath &&
      value.spaceDirectoryPath !== repoRoot &&
      value.spaceDirectoryPath.includes(branchName),
    'Space directory to switch to created worktree',
    20_000,
  )
  createdWorktreePath = state.spaceDirectoryPath
}

async function openPaneContextMenuInSpace(page, offset) {
  const pane = page.locator('.workspace-canvas .react-flow__pane')
  const rect = await page.evaluate(async targetSpaceId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const parsed = raw ? JSON.parse(raw) : null
    const workspace = parsed?.workspaces?.find(item => item.id === parsed.activeWorkspaceId)
    return workspace?.spaces?.find(item => item.id === targetSpaceId)?.rect ?? null
  }, spaceId)
  if (!rect) {
    fail('Space rect not available for context-menu placement')
  }
  const box = await pane.boundingBox()
  if (!box) {
    fail('Canvas pane bounding box unavailable')
  }
  const viewport = await page.evaluate(() => {
    const element = document.querySelector('.react-flow__viewport')
    const match = element
      ? window.getComputedStyle(element).transform.match(/matrix\(([^)]+)\)/)
      : null
    const values = match ? match[1].split(',').map(item => Number(item.trim())) : []
    return {
      zoom: Number.isFinite(values[0]) ? values[0] : 1,
      x: Number.isFinite(values[4]) ? values[4] : 0,
      y: Number.isFinite(values[5]) ? values[5] : 0,
    }
  })
  const flowPoint = {
    x: rect.x + rect.width * offset.x,
    y: rect.y + rect.height * offset.y,
  }
  const clientX = box.x + flowPoint.x * viewport.zoom + viewport.x
  const clientY = box.y + flowPoint.y * viewport.zoom + viewport.y
  await pane.evaluate(
    (element, payload) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          button: 2,
          clientX: payload.clientX,
          clientY: payload.clientY,
          bubbles: true,
          cancelable: true,
        }),
      ),
    { clientX, clientY },
  )
}

function terminalNodeById(page, nodeId) {
  return page.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node`)
}

async function focusTerminalNode(page, node) {
  const cell = await node.evaluate(element => {
    const id = element.closest('.react-flow__node')?.getAttribute('data-id')
    return id ? window.__opencoveTerminalSelectionTestApi?.getCellCenter(id, 2, 2) : null
  })
  const target = cell ?? fail('Terminal cell center unavailable for focus')
  await page.mouse.click(target.x, target.y)
}

async function createTerminalInSpace(page) {
  const before = (await readState(page))?.terminalCount ?? 0
  await openPaneContextMenuInSpace(page, { x: 0.25 + before * 0.14, y: 0.28 })
  await page.locator('[data-testid="workspace-context-new-terminal"]').click()
  await poll(
    async () => (await readState(page))?.terminalCount ?? 0,
    count => count === before + 1,
    'terminal node creation',
    20_000,
  )
  const nodeId = (await readState(page))?.terminalDirectories?.[before]?.id
  return terminalNodeById(page, nodeId)
}

async function createAgentInSpace(page) {
  const before = (await readState(page))?.agentCount ?? 0
  await openPaneContextMenuInSpace(page, { x: 0.34 + before * 0.14, y: 0.72 })
  await page.locator('[data-testid="workspace-context-run-default-agent"]').click()
  await poll(
    async () => (await readState(page))?.agentCount ?? 0,
    count => count === before + 1,
    'agent node creation',
    30_000,
  )
  const nodeId = (await readState(page))?.agentDirectories?.[before]?.id
  const agent = terminalNodeById(page, nodeId)
  await waitForAgentReady(page, agent, before)
  return agent
}

async function waitForNodeText(node, text, label, timeoutMs = 20_000, compact = false) {
  const normalize = value => (compact ? value.replace(/\s+/g, '') : value)
  await poll(
    async () => normalize((await node.textContent()) ?? ''),
    value => value.includes(normalize(text)),
    label,
    timeoutMs,
  )
}

async function readTranscript(page, nodeId) {
  return await page.evaluate(currentNodeId => {
    const reader = window.__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__
    return typeof reader === 'function' ? reader(currentNodeId) : ''
  }, nodeId)
}

async function waitForAgentReady(page, agentNode, index) {
  const agentState = await poll(
    async () => (await readState(page))?.agentDirectories?.[index] ?? null,
    value => typeof value?.id === 'string' && value.id.length > 0,
    `agent ${index} persisted id`,
    20_000,
  )
  const codexMarker = /OpenAI\s+Codex|Codex|Ask Codex|Working/i
  await poll(
    async () => {
      const text = `${await agentNode.textContent()}\n${await readTranscript(page, agentState.id)}`
      return text
    },
    text => codexMarker.test(text),
    `agent ${index} real Codex TUI`,
    60_000,
  )
  return agentState.id
}

async function assertRuntimeDirectories(page, expectedTerminalCount, expectedAgentCount) {
  const state = await poll(
    async () => await readState(page),
    value =>
      value?.terminalCount === expectedTerminalCount && value?.agentCount === expectedAgentCount,
    'persisted runtime node counts',
    20_000,
  )
  const directories = [...(state.terminalDirectories ?? []), ...(state.agentDirectories ?? [])]
  for (const directory of directories) {
    if (directory.executionDirectory !== createdWorktreePath) {
      fail('Runtime node executionDirectory is not the Space worktree', { directory, state })
    }
    if (directory.expectedDirectory !== createdWorktreePath) {
      fail('Runtime node expectedDirectory is not the Space worktree', { directory, state })
    }
  }
  return state
}

async function assertTerminalRepliesWithCwd(page, terminalNode, label) {
  const token = `REAL_CODEX_TERMINAL_${label}_${runId}`
  const command = buildNodeEvalCommand(
    `process.stdout.write(${JSON.stringify(token)} + ':' + process.cwd() + '\\n')`,
  )
  await poll(
    async () => await terminalNode.locator('.terminal-node__terminal').getAttribute('aria-busy'),
    value => value === 'false',
    `${label} terminal ready`,
    20_000,
  )
  await focusTerminalNode(page, terminalNode)
  await page.keyboard.press('Control+U')
  await page.keyboard.type(command, { delay: 5 })
  await page.keyboard.press('Enter')
  await waitForNodeText(terminalNode, token, `${label} terminal response`, 20_000)
  await waitForNodeText(
    terminalNode,
    path.basename(createdWorktreePath),
    `${label} terminal cwd`,
    20_000,
    true,
  )
}

async function assertCodexStarted(page, agentNode, index) {
  await waitForAgentReady(page, agentNode, index)
}

async function cleanupGitWorktree() {
  if (createdWorktreePath) {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', createdWorktreePath], {
        cwd: repoRoot,
      })
    } catch {
      await removePathWithRetry(createdWorktreePath)
    }
  }
  try {
    await execFileAsync('git', ['branch', '-D', branchName], { cwd: repoRoot })
  } catch {
    // ignore missing branch
  }
}

async function main() {
  const first = await launchApp()
  try {
    const mountId = await ensureLocalMount(first.page)
    await seedWorkspace(first.page, mountId)
    await createSpaceWorktree(first.page)

    const terminal = await createTerminalInSpace(first.page)
    await assertTerminalRepliesWithCwd(first.page, terminal, 'initial')
    const agent = await createAgentInSpace(first.page)
    await assertCodexStarted(first.page, agent, 0)
    await assertRuntimeDirectories(first.page, 1, 1)
  } finally {
    await first.app.close().catch(() => undefined)
  }

  const restarted = await launchApp()
  try {
    const restoredState = await assertRuntimeDirectories(restarted.page, 1, 1)
    await restarted.page.locator(`[data-testid="workspace-space-switch-${spaceId}"]`).click()
    const restoredTerminal = terminalNodeById(
      restarted.page,
      restoredState.terminalDirectories[0].id,
    )
    const restoredAgent = terminalNodeById(restarted.page, restoredState.agentDirectories[0].id)
    await restoredTerminal.waitFor({ state: 'visible', timeout: 30_000 })
    await restoredAgent.waitFor({ state: 'visible', timeout: 60_000 })

    await assertTerminalRepliesWithCwd(restarted.page, restoredTerminal, 'restored')
    await assertCodexStarted(restarted.page, restoredAgent, 0)

    const newTerminal = await createTerminalInSpace(restarted.page)
    await assertTerminalRepliesWithCwd(restarted.page, newTerminal, 'post_restart_created')
    const newAgent = await createAgentInSpace(restarted.page)
    await assertCodexStarted(restarted.page, newAgent, 1)
    await assertRuntimeDirectories(restarted.page, 2, 2)
  } finally {
    await restarted.app.close().catch(() => undefined)
  }

  process.stdout.write('[space-worktree-real-codex-e2e] PASS\n')
}

try {
  await main()
} finally {
  await cleanupGitWorktree()
  if (userDataDir) {
    await removePathWithRetry(userDataDir)
  }
}
