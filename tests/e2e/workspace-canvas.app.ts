import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'path'

const electronAppPath = path.resolve(__dirname, '../../')
const testAgentStubScriptPath = path.resolve(__dirname, '../../scripts/test-agent-session-stub.mjs')
const testWorkspacePath = path.resolve(__dirname, '../../')
type E2EWindowMode = 'normal' | 'inactive' | 'offscreen' | 'hidden'
const E2E_APP_CLOSE_TIMEOUT_MS = 5_000
const E2E_APP_FORCE_KILL_TIMEOUT_MS = 2_000
const E2E_APP_FORCE_KILL_POLL_MS = 50
const E2E_USER_DATA_DIR_CLEANUP_RETRY_DELAY_MS = 100
const E2E_USER_DATA_DIR_CLEANUP_MAX_ATTEMPTS = 6

let lastLaunchedWindowMode: E2EWindowMode | null = null

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

export async function bringWindowToFrontForNormalMode(window: Page): Promise<void> {
  const resolvedMode =
    lastLaunchedWindowMode ?? (process.env['OPENCOVE_E2E_WINDOW_MODE'] as E2EWindowMode | undefined)

  if (resolvedMode !== 'normal') {
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

function isRetryableUserDataCleanupError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY'
}

async function cleanupUserDataDirWithRetry(userDataDir: string, attempt = 1): Promise<void> {
  try {
    await rm(userDataDir, { recursive: true, force: true })
  } catch (error) {
    const isRetryableWindowsCleanupError =
      process.platform === 'win32' && isRetryableUserDataCleanupError(error)
    const shouldRetry =
      isRetryableWindowsCleanupError && attempt < E2E_USER_DATA_DIR_CLEANUP_MAX_ATTEMPTS

    if (!shouldRetry) {
      if (isRetryableWindowsCleanupError) {
        // Chromium can release DIPS/shared-memory artifacts after Electron has already exited.
        // Each E2E run gets a unique temp dir, so a final cleanup miss is preferable to a false test failure.
        process.stderr.write(
          `[e2e] Skipping locked Windows userData cleanup for ${userDataDir}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        )
        return
      }

      throw error
    }

    await delay(E2E_USER_DATA_DIR_CLEANUP_RETRY_DELAY_MS * attempt)
    await cleanupUserDataDirWithRetry(userDataDir, attempt + 1)
  }
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
      await cleanupUserDataDirWithRetry(userDataDir)
    }
  }
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
  lastLaunchedWindowMode = launchMode
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
      await cleanupUserDataDirWithRetry(userDataDir)
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
