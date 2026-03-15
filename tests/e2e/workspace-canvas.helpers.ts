import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'

const electronAppPath = path.resolve(__dirname, '../../')
const testAgentStubScriptPath = path.resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')
export const testWorkspacePath = path.resolve(__dirname, '../../')
export const storageKey = 'cove:m0:workspace-state'
export const seededWorkspaceId = 'workspace-seeded'
export { beginDragMouse, dragLocatorTo, dragMouse } from './workspace-canvas.gestures'
type E2EWindowMode = 'normal' | 'inactive' | 'offscreen' | 'hidden'
const E2E_APP_CLOSE_TIMEOUT_MS = 5_000
const E2E_APP_FORCE_KILL_TIMEOUT_MS = 2_000
const E2E_APP_FORCE_KILL_POLL_MS = 50

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

async function bringWindowToFrontForNormalMode(window: Page): Promise<void> {
  if ((process.env['OPENCOVE_E2E_WINDOW_MODE'] as E2EWindowMode | undefined) !== 'normal') {
    return
  }

  await window.bringToFront().catch(() => undefined)
  await window.waitForTimeout(50)
}

function isRetryableLaunchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Process failed to launch') ||
    message.includes('SIGABRT') ||
    message.includes('SIGSEGV') ||
    message.includes('Target page, context or browser has been closed')
  )
}

function resolveLaunchModes(windowMode?: E2EWindowMode): E2EWindowMode[] {
  const requestedMode =
    windowMode ??
    (process.env['OPENCOVE_E2E_WINDOW_MODE'] as E2EWindowMode | undefined) ??
    'offscreen'

  if (isTruthyEnv(process.env['OPENCOVE_E2E_DISABLE_CRASH_FALLBACK'])) {
    return [requestedMode]
  }

  const candidates: E2EWindowMode[] = [requestedMode]

  if (requestedMode === 'hidden') {
    candidates.push('offscreen', 'inactive', 'normal')
  } else if (requestedMode === 'offscreen') {
    candidates.push('inactive', 'normal')
  }

  return [...new Set(candidates)]
}

function shouldDisableElectronSandboxForLinuxCi(): boolean {
  return process.platform === 'linux' && isTruthyEnv(process.env['CI'])
}

function resolveElectronLaunchArgs(): string[] {
  if (!shouldDisableElectronSandboxForLinuxCi()) {
    return [electronAppPath]
  }

  return ['--no-sandbox', '--disable-dev-shm-usage', electronAppPath]
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export async function createTestUserDataDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'cove-e2e-user-data-'))
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code !== 'ESRCH'
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  if (!isProcessAlive(pid) || timeoutMs <= 0) {
    return
  }

  const nextDelayMs = Math.min(E2E_APP_FORCE_KILL_POLL_MS, timeoutMs)
  await delay(nextDelayMs)
  await waitForProcessExit(pid, timeoutMs - nextDelayMs)
}

async function closeElectronAppAndCleanup(
  electronApp: ElectronApplication,
  originalClose: () => Promise<void>,
  userDataDir: string,
  cleanupUserDataDir: boolean,
): Promise<void> {
  const appProcess = electronApp.process()
  const appPid = typeof appProcess.pid === 'number' && appProcess.pid > 0 ? appProcess.pid : null

  try {
    await Promise.race([
      (async () => {
        const closeEventPromise = electronApp
          .waitForEvent('close', { timeout: E2E_APP_CLOSE_TIMEOUT_MS })
          .catch(() => undefined)

        await originalClose().catch(() => undefined)
        await closeEventPromise
      })(),
      delay(E2E_APP_CLOSE_TIMEOUT_MS),
    ])
  } finally {
    if (appPid !== null && isProcessAlive(appPid)) {
      try {
        process.kill(appPid, 'SIGKILL')
      } catch {
        // ignore force-kill failures
      }

      await waitForProcessExit(appPid, E2E_APP_FORCE_KILL_TIMEOUT_MS).catch(() => undefined)
    }

    if (cleanupUserDataDir) {
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}

export interface SeedAgentData {
  provider: 'claude-code' | 'codex' | 'opencode' | 'gemini'
  prompt: string
  model: string | null
  effectiveModel: string | null
  launchMode: 'new' | 'resume'
  resumeSessionId: string | null
  resumeSessionIdVerified?: boolean
  executionDirectory: string
  expectedDirectory?: string | null
  directoryMode: 'workspace' | 'custom'
  customDirectory: string | null
  shouldCreateDirectory: boolean
}

export interface SeedTaskData {
  requirement: string
  status: 'todo' | 'doing' | 'ai_done' | 'done'
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  tags?: string[]
  linkedAgentNodeId: string | null
  lastRunAt: string | null
  autoGeneratedTitle: boolean
  createdAt?: string | null
  updatedAt?: string | null
}

export interface SeedNoteData {
  text: string
}

export interface SeedNode {
  id: string
  title: string
  position: {
    x: number
    y: number
  }
  width: number
  height: number
  kind?: 'terminal' | 'agent' | 'task' | 'note'
  status?: 'running' | 'standby' | 'exited' | 'failed' | 'stopped' | 'restoring' | null
  startedAt?: string | null
  endedAt?: string | null
  exitCode?: number | null
  lastError?: string | null
  scrollback?: string | null
  executionDirectory?: string | null
  expectedDirectory?: string | null
  agent?: SeedAgentData | null
  task?: SeedTaskData | SeedNoteData | null
}

export interface SeedWorkspace {
  id: string
  name: string
  path: string
  nodes: SeedNode[]
  spaces?: Array<{
    id: string
    name: string
    directoryPath: string
    nodeIds: string[]
    rect?: {
      x: number
      y: number
      width: number
      height: number
    } | null
  }>
  activeSpaceId?: string | null
}

async function launchAppInMode(
  launchMode: E2EWindowMode,
  options: {
    env?: Record<string, string | undefined>
    userDataDir?: string
    cleanupUserDataDir?: boolean
  } = {},
  attempt = 0,
): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const userDataDir = options.userDataDir ?? (await createTestUserDataDir())
  const cleanupUserDataDir = options.cleanupUserDataDir ?? true
  const testHomeDir = path.join(userDataDir, 'home')
  const testConfigDir = path.join(userDataDir, 'config')
  const testCacheDir = path.join(userDataDir, 'cache')
  const testRuntimeDir = path.join(userDataDir, 'runtime')
  await mkdir(testHomeDir, { recursive: true })
  await mkdir(testConfigDir, { recursive: true })
  await mkdir(testCacheDir, { recursive: true })
  await mkdir(testRuntimeDir, { recursive: true, mode: 0o700 })
  let electronApp: ElectronApplication | null = null

  try {
    electronApp = await electron.launch({
      args: resolveElectronLaunchArgs(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOME: testHomeDir,
        USERPROFILE: testHomeDir,
        XDG_CONFIG_HOME: testConfigDir,
        XDG_CACHE_HOME: testCacheDir,
        XDG_RUNTIME_DIR: testRuntimeDir,
        OPENCOVE_TEST_WORKSPACE: testWorkspacePath,
        OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: testAgentStubScriptPath,
        OPENCOVE_E2E_WINDOW_MODE: launchMode,
        ...(shouldDisableElectronSandboxForLinuxCi() ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}),
        ...options.env,
      },
    })

    const originalClose = electronApp.close.bind(electronApp)
    let closePromise: Promise<void> | null = null
    ;(electronApp as unknown as { close: () => Promise<void> }).close = async () => {
      closePromise ??= closeElectronAppAndCleanup(
        electronApp,
        originalClose,
        userDataDir,
        cleanupUserDataDir,
      )
      return await closePromise
    }

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await bringWindowToFrontForNormalMode(window)

    return { electronApp, window }
  } catch (error) {
    if (electronApp) {
      await electronApp.close().catch(() => undefined)
    } else if (cleanupUserDataDir) {
      await rm(userDataDir, { recursive: true, force: true })
    }

    const shouldRetryCurrentMode = isRetryableLaunchError(error) && attempt < 1
    if (shouldRetryCurrentMode) {
      await delay(250)
      return await launchAppInMode(launchMode, options, attempt + 1)
    }

    throw error
  }
}

async function launchAppWithModes(
  launchModes: E2EWindowMode[],
  options: {
    env?: Record<string, string | undefined>
    userDataDir?: string
    cleanupUserDataDir?: boolean
  } = {},
  index = 0,
): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const launchMode = launchModes[index]
  if (!launchMode) {
    throw new Error('No E2E window mode available for Electron launch')
  }

  try {
    return await launchAppInMode(launchMode, options)
  } catch (error) {
    if (index >= launchModes.length - 1) {
      throw error
    }

    return await launchAppWithModes(launchModes, options, index + 1)
  }
}

export async function launchApp(options?: {
  windowMode?: E2EWindowMode
  env?: Record<string, string | undefined>
  userDataDir?: string
  cleanupUserDataDir?: boolean
}): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const launchModes = resolveLaunchModes(options?.windowMode)
  return await launchAppWithModes(launchModes, options)
}

export async function seedWorkspaceState(
  window: Page,
  payload: {
    activeWorkspaceId: string
    workspaces: SeedWorkspace[]
    settings?: unknown
  },
): Promise<void> {
  const seededState = {
    formatVersion: 1,
    activeWorkspaceId: payload.activeWorkspaceId,
    workspaces: payload.workspaces,
    ...(payload.settings ? { settings: payload.settings } : {}),
  }

  const trySeed = async (attempt: number): Promise<boolean> => {
    if (attempt >= 3) {
      return false
    }

    const writeResult = await window.evaluate(async state => {
      return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
        raw: JSON.stringify(state),
      })
    }, seededState)

    if (!writeResult.ok) {
      throw new Error(
        `Failed to seed workspace state: ${writeResult.reason}: ${writeResult.error.code}${
          writeResult.error.debugMessage ? `: ${writeResult.error.debugMessage}` : ''
        }`,
      )
    }

    await window.reload({ waitUntil: 'domcontentloaded' })
    await bringWindowToFrontForNormalMode(window)

    const expectedWorkspaces = payload.workspaces.map(workspace => ({
      id: workspace.id,
      nodeIds: workspace.nodes.map(node => node.id),
    }))

    const seededReady = await window.evaluate(async expectedWorkspaces => {
      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      if (!raw) {
        return false
      }

      try {
        const parsed = JSON.parse(raw) as {
          workspaces?: Array<{
            id?: string
            nodes?: Array<{
              id?: string
            }>
          }>
        }

        if (!Array.isArray(parsed.workspaces)) {
          return false
        }

        const workspaceById = new Map(
          parsed.workspaces
            .filter(workspace => typeof workspace.id === 'string')
            .map(workspace => [workspace.id as string, workspace]),
        )

        return expectedWorkspaces.every(expectedWorkspace => {
          const loadedWorkspace = workspaceById.get(expectedWorkspace.id)
          if (!loadedWorkspace || !Array.isArray(loadedWorkspace.nodes)) {
            return false
          }

          const loadedNodeIds = loadedWorkspace.nodes
            .map(node => (typeof node.id === 'string' ? node.id : ''))
            .filter(id => id.length > 0)

          if (loadedNodeIds.length !== expectedWorkspace.nodeIds.length) {
            return false
          }

          return expectedWorkspace.nodeIds.every(nodeId => loadedNodeIds.includes(nodeId))
        })
      } catch {
        return false
      }
    }, expectedWorkspaces)

    const workspaceCount = await window.locator('.workspace-item').count()
    if (seededReady && workspaceCount >= payload.workspaces.length) {
      return true
    }

    return await trySeed(attempt + 1)
  }

  const success = await trySeed(0)
  if (!success) {
    throw new Error('Failed to deterministically seed workspace state')
  }
}

export async function clearAndSeedWorkspace(
  window: Page,
  nodes: SeedNode[],
  options?: {
    settings?: unknown
    spaces?: SeedWorkspace['spaces']
    activeSpaceId?: string | null
  },
): Promise<void> {
  await seedWorkspaceState(window, {
    activeWorkspaceId: seededWorkspaceId,
    workspaces: [
      {
        id: seededWorkspaceId,
        name: path.basename(testWorkspacePath),
        path: testWorkspacePath,
        nodes,
        ...(options?.spaces ? { spaces: options.spaces } : {}),
        ...(options && 'activeSpaceId' in options ? { activeSpaceId: options.activeSpaceId } : {}),
      },
    ],
    settings: options?.settings,
  })
}

export async function readCanvasViewport(
  window: Page,
): Promise<{ x: number; y: number; zoom: number }> {
  return await window.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewport) {
      return { x: 0, y: 0, zoom: 1 }
    }

    const style = window.getComputedStyle(viewport)
    const transform = style.transform

    const matrixMatch = transform.match(/matrix\(([^)]+)\)/)
    if (matrixMatch) {
      const values = matrixMatch[1].split(',').map(item => Number(item.trim()))
      if (values.length < 6) {
        return { x: 0, y: 0, zoom: 1 }
      }

      const zoom = Number.isFinite(values[0]) ? values[0] : 1
      const x = Number.isFinite(values[4]) ? values[4] : 0
      const y = Number.isFinite(values[5]) ? values[5] : 0

      return { x, y, zoom }
    }

    const matrix3dMatch = transform.match(/matrix3d\(([^)]+)\)/)
    if (!matrix3dMatch) {
      return { x: 0, y: 0, zoom: 1 }
    }

    const values = matrix3dMatch[1].split(',').map(item => Number(item.trim()))
    if (values.length < 16) {
      return { x: 0, y: 0, zoom: 1 }
    }

    const zoom = Number.isFinite(values[0]) ? values[0] : 1
    const x = Number.isFinite(values[12]) ? values[12] : 0
    const y = Number.isFinite(values[13]) ? values[13] : 0

    return { x, y, zoom }
  })
}
