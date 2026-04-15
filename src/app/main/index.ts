import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { hydrateCliEnvironmentForAppLaunch } from '../../platform/os/CliEnvironment'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { registerControlSurfaceServer } from './controlSurface/registerControlSurfaceServer'
import {
  configureAppCommandLine,
  configureAppUserDataPath,
  isTruthyEnv,
  resolveE2EWindowMode,
} from './appRuntimeConfig'
import { setRuntimeIconTestState } from './iconTestHarness'
import { resolveRuntimeIconPath } from './runtimeIcon'
import { resolveTitleBarOverlay } from './ipc/registerWindowChromeIpcHandlers'
import { createApprovedWorkspaceStore } from '../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createPtyRuntime } from '../../contexts/terminal/presentation/main-ipc/runtime'
import { resolveHomeWorkerEndpoint } from './worker/resolveHomeWorkerEndpoint'
import { createHomeWorkerEndpointResolver } from './worker/homeWorkerEndpointResolver'
import { hasOwnedLocalWorkerProcess, stopOwnedLocalWorker } from './worker/localWorkerManager'
import { createMainRuntimeDiagnosticsLogger } from './runtimeDiagnostics'
import { registerQuitCoordinator } from './quitCoordinator'
import { requestRendererPersistFlush } from './rendererPersistFlush'

let ipcDisposable: ReturnType<typeof registerIpcHandlers> | null = null
let controlSurfaceDisposable: ReturnType<typeof registerControlSurfaceServer> | null = null
const OPENCOVE_APP_USER_MODEL_ID = 'dev.deadwave.opencove'
const WINDOW_CLOSE_PERSIST_FLUSH_TIMEOUT_MS = 1_500
let isAppQuitInProgress = false

app.on('before-quit', () => {
  isAppQuitInProgress = true
})

configureAppCommandLine()
configureAppUserDataPath()

const EXTERNAL_PROTOCOL_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])
const E2E_OFFSCREEN_COORDINATE = -50_000
const mainWindowRuntimeLogger = createMainRuntimeDiagnosticsLogger('main-window')
const mainAppRuntimeLogger = createMainRuntimeDiagnosticsLogger('main-app')

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl.trim())
  } catch {
    return null
  }
}

function shouldOpenUrlExternally(rawUrl: string): boolean {
  const parsed = parseUrl(rawUrl)
  if (!parsed) {
    return false
  }

  return EXTERNAL_PROTOCOL_ALLOWLIST.has(parsed.protocol)
}

function resolveDevRendererOrigin(): string | null {
  const raw = process.env['ELECTRON_RENDERER_URL']
  if (!raw) {
    return null
  }

  const parsed = parseUrl(raw)
  return parsed ? parsed.origin : null
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath)

  if (relativePath === '') {
    return true
  }

  if (relativePath === '..') {
    return false
  }

  if (relativePath.startsWith(`..${sep}`)) {
    return false
  }

  if (isAbsolute(relativePath)) {
    return false
  }

  return true
}

function isAllowedFileNavigation(parsed: URL, rendererRootDir: string): boolean {
  let filePath: string

  try {
    filePath = fileURLToPath(parsed)
  } catch {
    return false
  }

  const normalizedRoot = resolve(rendererRootDir)
  const normalizedTarget = resolve(filePath)
  return isPathWithinRoot(normalizedRoot, normalizedTarget)
}

function isAllowedNavigationTarget(
  rawUrl: string,
  devOrigin: string | null,
  rendererRootDir: string,
): boolean {
  const parsed = parseUrl(rawUrl)
  if (!parsed) {
    return false
  }

  if (devOrigin && parsed.origin === devOrigin) {
    return true
  }

  if (!devOrigin && parsed.protocol === 'file:') {
    return isAllowedFileNavigation(parsed, rendererRootDir)
  }

  return false
}

function createWindow(): void {
  const devOrigin = is.dev ? resolveDevRendererOrigin() : null
  const rendererRootDir = join(__dirname, '../renderer')
  const e2eWindowMode = resolveE2EWindowMode()
  const isTestEnv = process.env['NODE_ENV'] === 'test'
  // In CI the window may not be considered foreground even in "normal" mode.
  // Disable background throttling for all test runs to keep rAF/timers deterministic.
  const keepRendererActiveInBackground = e2eWindowMode !== 'normal' || isTestEnv
  const keepRendererActiveWhenHidden = e2eWindowMode === 'hidden'
  const placeWindowOffscreen = e2eWindowMode === 'offscreen'
  const disableRendererSandboxForTests =
    isTestEnv && !isTruthyEnv(process.env['OPENCOVE_E2E_FORCE_RENDERER_SANDBOX'])
  const runtimeIconPath = resolveRuntimeIconPath()
  if (isTestEnv) {
    setRuntimeIconTestState(runtimeIconPath)
  }
  const initialWidth = isTestEnv ? 1440 : 1200
  const initialHeight = isTestEnv ? 900 : 800
  let hasCoordinatedWindowClose = false

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    show: false,
    ...(isTestEnv ? { useContentSize: true } : {}),
    ...(keepRendererActiveWhenHidden ? { paintWhenInitiallyHidden: true } : {}),
    ...(placeWindowOffscreen ? { x: E2E_OFFSCREEN_COORDINATE, y: E2E_OFFSCREEN_COORDINATE } : {}),
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: resolveTitleBarOverlay('dark'),
        }
      : {}),
    ...(runtimeIconPath ? { icon: runtimeIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      additionalArguments: [`--opencove-main-process-pid=${process.pid}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !disableRendererSandboxForTests,
      ...(keepRendererActiveInBackground ? { backgroundThrottling: false } : {}),
    },
  })

  mainWindow.on('close', event => {
    if (hasCoordinatedWindowClose || isAppQuitInProgress || mainWindow.isDestroyed()) {
      return
    }

    if (!event || typeof event.preventDefault !== 'function') {
      return
    }

    event.preventDefault()
    hasCoordinatedWindowClose = true

    void requestRendererPersistFlush(mainWindow.webContents, WINDOW_CLOSE_PERSIST_FLUSH_TIMEOUT_MS)
      .catch(() => undefined)
      .finally(() => {
        if (mainWindow.isDestroyed()) {
          return
        }

        mainWindow.close()
      })
  })

  const showWindow = (): void => {
    if (e2eWindowMode === 'hidden') {
      return
    }

    if (e2eWindowMode === 'offscreen') {
      mainWindow.setPosition(E2E_OFFSCREEN_COORDINATE, E2E_OFFSCREEN_COORDINATE, false)
      mainWindow.showInactive()
      return
    }

    if (e2eWindowMode === 'inactive') {
      mainWindow.showInactive()
      return
    }

    mainWindow.show()
  }

  mainWindow.on('ready-to-show', () => {
    showWindow()
  })

  // 兜底：Electron #42409 - titleBarOverlay + show:false 时 ready-to-show 在 Windows 上可能不触发
  const useReadyToShowFallback = process.platform === 'win32' && e2eWindowMode === 'normal'
  if (useReadyToShowFallback) {
    const READY_TO_SHOW_FALLBACK_MS = 2000
    const fallbackTimer = setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        showWindow()
      }
    }, READY_TO_SHOW_FALLBACK_MS)
    const clearFallback = (): void => clearTimeout(fallbackTimer)
    mainWindow.once('ready-to-show', clearFallback)
    mainWindow.once('closed', clearFallback)
  }

  // ── Crash recovery: reload the renderer on crash or GPU failure ──
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    mainWindowRuntimeLogger.error('render-process-gone', 'Renderer process gone.', {
      reason: details.reason,
      exitCode: details.exitCode,
    })
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  mainWindow.on('unresponsive', () => {
    mainWindowRuntimeLogger.error('window-unresponsive', 'Window became unresponsive.')
  })

  mainWindow.on('responsive', () => {
    mainWindowRuntimeLogger.info('window-responsive', 'Window became responsive again.')
  })

  mainWindow.webContents.setWindowOpenHandler(details => {
    if (shouldOpenUrlExternally(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationTarget(url, devOrigin, rendererRootDir)) {
      return
    }

    event.preventDefault()

    if (shouldOpenUrlExternally(url)) {
      void shell.openExternal(url)
    }
  })

  if (typeof mainWindow.webContents.setVisualZoomLevelLimits === 'function') {
    void mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined)
  }

  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(async () => {
  hydrateCliEnvironmentForAppLaunch(app.isPackaged === true)

  // Set app user model id for windows
  electronApp.setAppUserModelId(OPENCOVE_APP_USER_MODEL_ID)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Log GPU and child process crashes (these can cause white screens)
  app.on('child-process-gone', (_event, details) => {
    mainAppRuntimeLogger.error('child-process-gone', 'Child process gone.', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  const runtimeIconPath = resolveRuntimeIconPath()
  if (process.platform === 'darwin' && runtimeIconPath) {
    app.dock?.setIcon(nativeImage.createFromPath(runtimeIconPath))
  }

  if (isTruthyEnv(process.env['OPENCOVE_PTY_HOST_POC'])) {
    void (async () => {
      try {
        const { runPtyHostUtilityProcessPoc } = await import('../../platform/process/ptyHost/poc')
        await runPtyHostUtilityProcessPoc()
        app.exit(0)
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
        process.stderr.write(`[opencove] pty-host PoC failed: ${detail}\n`)
        app.exit(1)
      }
    })()
    return
  }

  if (isTruthyEnv(process.env['OPENCOVE_PTY_HOST_STRESS'])) {
    void (async () => {
      try {
        const { runPtyHostStressTest } = await import('../../platform/process/ptyHost/stress')
        await runPtyHostStressTest()
        app.exit(0)
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
        process.stderr.write(`[opencove] pty-host stress failed: ${detail}\n`)
        app.exit(1)
      }
    })()
    return
  }

  const approvedWorkspaces = createApprovedWorkspaceStore()
  const ptyRuntime = createPtyRuntime()

  const homeWorker = await resolveHomeWorkerEndpoint({
    allowConfig: process.env.NODE_ENV !== 'test',
    allowStandaloneMode: app.isPackaged === false,
    allowRemoteMode: app.isPackaged === false,
  })
  for (const message of homeWorker.diagnostics) {
    process.stderr.write(`[opencove] ${message}\n`)
  }

  const workerEndpointResolver =
    homeWorker.effectiveMode !== 'standalone'
      ? createHomeWorkerEndpointResolver({
          userDataPath: app.getPath('userData'),
          config: homeWorker.config,
          effectiveMode: homeWorker.effectiveMode,
        })
      : null

  ipcDisposable = registerIpcHandlers({
    approvedWorkspaces,
    ptyRuntime,
    ...(workerEndpointResolver
      ? {
          workerEndpointResolver,
        }
      : {}),
  })

  if (process.env.NODE_ENV !== 'test' && !workerEndpointResolver) {
    controlSurfaceDisposable = registerControlSurfaceServer({ approvedWorkspaces, ptyRuntime })
  }

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed.
// Tests must fully exit on macOS as well, otherwise Playwright can leave Electron running.
app.on('window-all-closed', () => {
  const shouldKeepTestAppAliveAfterWindowClose =
    process.env.NODE_ENV === 'test' &&
    isTruthyEnv(process.env['OPENCOVE_TEST_KEEP_APP_ALIVE_ON_WINDOW_ALL_CLOSED'])

  if (
    !shouldKeepTestAppAliveAfterWindowClose &&
    (process.env.NODE_ENV === 'test' || process.platform !== 'darwin')
  ) {
    app.quit()
  }
})

registerQuitCoordinator({
  hasOwnedLocalWorkerProcess,
  stopOwnedLocalWorker,
})

app.on('will-quit', () => {
  ipcDisposable?.dispose()
  ipcDisposable = null

  void controlSurfaceDisposable?.dispose()
  controlSurfaceDisposable = null
})
