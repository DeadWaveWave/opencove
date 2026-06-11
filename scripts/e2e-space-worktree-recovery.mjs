import { _electron as electron } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const testAgentStubScriptPath = path.join(repoRoot, 'scripts/test-agent-session-stub.mjs')
const workspaceId = 'workspace-mjs-space-worktree-recovery'
const spaceId = 'space-mjs-space-worktree-recovery'
const branchName = `opencove-mjs-space-wt-${Date.now()}`
const windowMode = process.env.OPENCOVE_E2E_WINDOW_MODE?.trim() || 'inactive'
const baseEnv = { ...process.env }
delete baseEnv.__CFBundleIdentifier
delete baseEnv.ELECTRON_RUN_AS_NODE

let createdWorktreePath = null
let userDataDir = null

function fail(message, detail) {
  const suffix = detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

async function removePathWithRetry(targetPath, attempts = 20) {
  try {
    await rm(targetPath, { recursive: true, force: true })
  } catch (error) {
    const code = error?.code
    if ((code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') && attempts > 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
      await removePathWithRetry(targetPath, attempts - 1)
    }
  }
}

function buildNodeEvalCommand(script) {
  const encodedScript = Buffer.from(script, 'utf8').toString('base64')
  return `node -e "eval(Buffer.from('${encodedScript}','base64').toString())"`
}

async function createUserDataDir() {
  const parent = path.join(os.tmpdir(), 'opencove-mjs-e2e')
  await mkdir(parent, { recursive: true })
  return await mkdtemp(path.join(parent, 'space-worktree-recovery-'))
}

async function launchApp() {
  userDataDir ??= await createUserDataDir()
  const homeDir = path.join(userDataDir, 'home')
  const configDir = path.join(userDataDir, 'config')
  const cacheDir = path.join(userDataDir, 'cache')
  const runtimeDir = path.join(userDataDir, 'runtime')
  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(configDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(runtimeDir, { recursive: true, mode: 0o700 }),
  ])

  const args =
    process.platform === 'linux' && process.env.CI
      ? ['--no-sandbox', '--disable-dev-shm-usage', repoRoot]
      : [repoRoot]

  const app = await electron.launch({
    timeout: 45_000,
    args,
    env: {
      ...baseEnv,
      NODE_ENV: 'test',
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_RUNTIME_DIR: runtimeDir,
      OPENCOVE_TEST_WORKSPACE: repoRoot,
      OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
      OPENCOVE_TEST_AGENT_STUB_SCRIPT: testAgentStubScriptPath,
      OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'stdin-echo',
      OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
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
    value => value === true,
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
        worktreesRoot: '',
        pullRequestBaseBranchOptions: [],
        environmentVariables: {},
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [
          {
            id: spaceId,
            name: 'MJS Space Worktree Recovery',
            directoryPath: repoRoot,
            targetMountId: mountId,
            labelColor: null,
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
      customModelEnabledByProvider: { 'claude-code': false, codex: true },
      customModelByProvider: { 'claude-code': '', codex: 'gpt-5.2-codex' },
      customModelOptionsByProvider: { 'claude-code': [], codex: ['gpt-5.2-codex'] },
      standardWindowSizeBucket: 'regular',
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
        spaceTargetMountId: space?.targetMountId ?? null,
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

async function poll(fn, predicate, label, timeoutMs = 15_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  const tick = async () => {
    lastValue = await fn()
    if (predicate(lastValue)) {
      return lastValue
    }
    if (Date.now() >= deadline) {
      fail(`Timed out waiting for ${label}`, lastValue)
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
    return await tick()
  }
  return await tick()
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
  return createdWorktreePath
}

async function openPaneContextMenuInSpace(page, offset = { x: 0.35, y: 0.35 }) {
  const pane = page.locator('.workspace-canvas .react-flow__pane')
  const rect = await page.evaluate(async targetSpaceId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    const workspace = parsed.workspaces?.find(item => item.id === parsed.activeWorkspaceId)
    const space = workspace?.spaces?.find(item => item.id === targetSpaceId)
    return space?.rect ?? null
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
    (element, payload) => {
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          button: 2,
          clientX: payload.clientX,
          clientY: payload.clientY,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { clientX, clientY },
  )
}

async function createTerminalInSpace(page) {
  const before = (await readState(page))?.terminalCount ?? 0
  await openPaneContextMenuInSpace(page, { x: 0.25 + before * 0.15, y: 0.28 })
  const item = page.locator('[data-testid="workspace-context-new-terminal"]')
  await item.waitFor({ state: 'visible' })
  await item.click()
  await poll(
    async () => (await readState(page))?.terminalCount ?? 0,
    count => count === before + 1,
    'terminal node creation',
    20_000,
  )
  return page
    .locator('.terminal-node')
    .filter({ hasNot: page.locator('.terminal-node__status') })
    .nth(before)
}

async function createAgentInSpace(page) {
  const before = (await readState(page))?.agentCount ?? 0
  await openPaneContextMenuInSpace(page, { x: 0.3 + before * 0.15, y: 0.72 })
  const item = page.locator('[data-testid="workspace-context-run-default-agent"]')
  await item.waitFor({ state: 'visible' })
  await item.click()
  await poll(
    async () => (await readState(page))?.agentCount ?? 0,
    count => count === before + 1,
    'agent node creation',
    20_000,
  )
  const agent = page
    .locator('.terminal-node')
    .filter({ has: page.locator('.terminal-node__status') })
    .nth(before)
  await waitForNodeText(agent, 'stdin-echo ready', 'agent stdin-echo startup', 20_000)
  return agent
}

async function waitForNodeText(node, text, label, timeoutMs = 15_000, compact = false) {
  const normalize = value => (compact ? value.replace(/\s+/g, '') : value)
  await poll(
    async () => normalize((await node.textContent()) ?? ''),
    value => value.includes(normalize(text)),
    label,
    timeoutMs,
  )
}

async function assertRuntimeDirectories(page, expectedTerminalCount, expectedAgentCount) {
  const state = await poll(
    async () => await readState(page),
    value =>
      value?.terminalCount === expectedTerminalCount && value?.agentCount === expectedAgentCount,
    'persisted runtime node counts',
    15_000,
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
}

async function assertTerminalRepliesWithCwd(page, terminalNode, label) {
  const token = `MJS_TERMINAL_${label}_${Date.now()}`
  const command = buildNodeEvalCommand(
    `process.stdout.write(${JSON.stringify(token)} + ':' + process.cwd() + '\\n')`,
  )
  await poll(
    async () => await terminalNode.locator('.terminal-node__terminal').getAttribute('aria-busy'),
    value => value === 'false',
    `${label} terminal ready`,
    15_000,
  )
  await terminalNode.locator('.xterm').click()
  await terminalNode.locator('.xterm-helper-textarea').waitFor({ state: 'attached' })
  await page.keyboard.press('Control+U')
  await page.keyboard.type(command, { delay: 5 })
  await page.keyboard.press('Enter')
  await waitForNodeText(terminalNode, token, `${label} terminal response`, 15_000)
  await waitForNodeText(
    terminalNode,
    path.basename(createdWorktreePath),
    `${label} terminal cwd`,
    15_000,
    true,
  )
}

async function assertAgentReplies(page, agentNode, char, label) {
  const hex = Buffer.from(char, 'utf8').toString('hex')
  await agentNode.locator('.xterm').click()
  await agentNode.locator('.xterm-helper-textarea').waitFor({ state: 'attached' })
  await page.keyboard.type(char, { delay: 5 })
  await page.keyboard.press('Enter')
  await waitForNodeText(agentNode, `stdin_hex=${hex}`, `${label} agent stdin reply`, 15_000)
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
    await assertAgentReplies(first.page, agent, '!', 'initial')
    await assertRuntimeDirectories(first.page, 1, 1)
  } finally {
    await first.app.close().catch(() => undefined)
  }

  const restarted = await launchApp()
  try {
    await assertRuntimeDirectories(restarted.page, 1, 1)
    const restoredTerminal = restarted.page
      .locator('.terminal-node')
      .filter({ hasNot: restarted.page.locator('.terminal-node__status') })
      .first()
    const restoredAgent = restarted.page
      .locator('.terminal-node')
      .filter({ has: restarted.page.locator('.terminal-node__status') })
      .first()
    await restoredTerminal.waitFor({ state: 'visible', timeout: 30_000 })
    await restoredAgent.waitFor({ state: 'visible', timeout: 30_000 })

    await assertTerminalRepliesWithCwd(restarted.page, restoredTerminal, 'restored')
    await assertAgentReplies(restarted.page, restoredAgent, '~', 'restored')

    const newTerminal = await createTerminalInSpace(restarted.page)
    await assertTerminalRepliesWithCwd(restarted.page, newTerminal, 'post_restart_created')
    const newAgent = await createAgentInSpace(restarted.page)
    await assertAgentReplies(restarted.page, newAgent, '$', 'post_restart_created')
    await assertRuntimeDirectories(restarted.page, 2, 2)
  } finally {
    await restarted.app.close().catch(() => undefined)
  }

  process.stdout.write('[space-worktree-e2e] PASS\n')
}

try {
  await main()
} finally {
  await cleanupGitWorktree()
  if (userDataDir) {
    await removePathWithRetry(userDataDir)
  }
}
