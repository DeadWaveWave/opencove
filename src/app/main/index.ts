import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { hydrateCliEnvironmentForAppLaunch } from '../../platform/os/CliEnvironment'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { registerControlSurfaceServer } from './controlSurface/registerControlSurfaceServer'
import { setRuntimeIconTestState } from './iconTestHarness'
import { resolveRuntimeIconPath } from './runtimeIcon'
import { resolveTitleBarOverlay } from './ipc/registerWindowChromeIpcHandlers'
import { shouldEnableWaylandIme } from './waylandIme'
import { createApprovedWorkspaceStore } from '../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createPtyRuntime } from '../../contexts/terminal/presentation/main-ipc/runtime'
import { resolveHomeWorkerEndpoint } from './worker/resolveHomeWorkerEndpoint'
import { createHomeWorkerEndpointResolver } from './worker/homeWorkerEndpointResolver'
import { hasOwnedLocalWorkerProcess, stopOwnedLocalWorker } from './worker/localWorkerManager'
import { createMainRuntimeDiagnosticsLogger } from './runtimeDiagnostics'
import { createStandaloneMountAwarePtyRuntime } from './controlSurface/standaloneMountAwarePtyRuntime'
import { registerQuickPhrasesContextMenu } from './contextMenu/registerQuickPhrasesContextMenu'
import {
  isAllowedNavigationTarget,
  resolveDevRendererOrigin,
  shouldOpenUrlExternally,
} from './navigationGuards'

let ipcDisposable: ReturnType<typeof registerIpcHandlers> | null = null
let controlSurfaceDisposable: ReturnType<typeof registerControlSurfaceServer> | null = null
let isCleaningUpOwnedLocalWorkerOnQuit = false
let workerEndpointResolverForContextMenu: ReturnType<
  typeof createHomeWorkerEndpointResolver
> | null = null
const APP_USER_DATA_DIRECTORY_NAME = 'opencove'
const OPENCOVE_APP_USER_MODEL_ID = 'dev.deadwave.opencove'

if (process.env['NODE_ENV'] === 'test') {
  // Keep renderer responsive in headful CI where occlusion/backgrounding can pause rAF/timers (esp. macOS).
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-background-timer-throttling')

  const existingDisableFeatures =
    typeof app.commandLine.getSwitchValue === 'function'
      ? app.commandLine.getSwitchValue('disable-features')
      : ''
  const disableFeatures = new Set(
    existingDisableFeatures
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0),
  )
  disableFeatures.add('CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-features', [...disableFeatures].join(','))
}

if (process.platform === 'linux' && process.env['NODE_ENV'] === 'test') {
  const disableSandboxForCi =
    (process.env['CI'] === '1' || process.env['CI']?.toLowerCase() === 'true') &&
    process.env['ELECTRON_DISABLE_SANDBOX'] === '1'

  if (disableSandboxForCi) {
    app.commandLine.appendSwitch('no-sandbox')
    app.commandLine.appendSwitch('disable-dev-shm-usage')
  }
}

if (shouldEnableWaylandIme({ platform: process.platform, env: process.env })) {
  app.commandLine.appendSwitch('enable-wayland-ime')
}

function preserveCanonicalUserDataPath(): void {
  const appDataPath = app.getPath('appData')
  app.setPath('userData', resolve(appDataPath, APP_USER_DATA_DIRECTORY_NAME))
}

if (process.env.NODE_ENV !== 'test') {
  preserveCanonicalUserDataPath()
}

if (process.env.NODE_ENV === 'test' && process.env['OPENCOVE_TEST_USER_DATA_DIR']) {
  app.setPath('userData', resolve(process.env['OPENCOVE_TEST_USER_DATA_DIR']))
} else if (app.isPackaged === false) {
  const wantsSharedUserData =
    isTruthyEnv(process.env['OPENCOVE_DEV_USE_SHARED_USER_DATA']) ||
    process.argv.includes('--opencove-shared-user-data') ||
    process.argv.includes('--shared-user-data')

  if (!wantsSharedUserData) {
    const explicitDevUserDataDir = process.env['OPENCOVE_DEV_USER_DATA_DIR']
    const defaultUserDataDir = app.getPath('userData')
    const devUserDataDir = explicitDevUserDataDir
      ? resolve(explicitDevUserDataDir)
      : `${defaultUserDataDir}-dev`

    app.setPath('userData', devUserDataDir)
  }
}

const E2E_OFFSCREEN_COORDINATE = -50_000
type E2EWindowMode = 'normal' | 'inactive' | 'hidden' | 'offscreen'
const mainWindowRuntimeLogger = createMainRuntimeDiagnosticsLogger('main-window')
const mainAppRuntimeLogger = createMainRuntimeDiagnosticsLogger('main-app')

function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function parseE2EWindowMode(rawValue: string | undefined): E2EWindowMode | null {
  if (!rawValue) {
    return null
  }

  const normalized = rawValue.toLowerCase()
  if (
    normalized === 'normal' ||
    normalized === 'inactive' ||
    normalized === 'hidden' ||
    normalized === 'offscreen'
  ) {
    return normalized
  }

  return null
}

function resolveE2EWindowMode(): E2EWindowMode {
  if (process.env['NODE_ENV'] !== 'test') {
    return 'normal'
  }

  const explicitMode = parseE2EWindowMode(process.env['OPENCOVE_E2E_WINDOW_MODE'])
  if (explicitMode) {
    // E2E runs must never steal OS focus. Treat explicit "normal" as "inactive".
    if (explicitMode === 'normal') {
      return 'inactive'
    }

    return explicitMode
  }

  // Keep honoring the legacy no-focus behavior flag alongside window modes.
  if (isTruthyEnv(process.env['OPENCOVE_E2E_NO_FOCUS'])) {
    return 'inactive'
  }

  return 'offscreen'
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !disableRendererSandboxForTests,
      ...(keepRendererActiveInBackground ? { backgroundThrottling: false } : {}),
    },
  })

  const quickPhrasesContextMenuDisposable = registerQuickPhrasesContextMenu({
    window: mainWindow,
    userDataPath: app.getPath('userData'),
    workerEndpointResolver: workerEndpointResolverForContextMenu,
  })
  mainWindow.on('closed', () => {
    quickPhrasesContextMenuDisposable.dispose()
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

  // Load renderer URL (dev server in dev, local HTML in prod).
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Electron ready: create browser windows & IPC.
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
  workerEndpointResolverForContextMenu = workerEndpointResolver

  if (!workerEndpointResolver) {
    const localPtyRuntime = createPtyRuntime()

    controlSurfaceDisposable = registerControlSurfaceServer({
      approvedWorkspaces,
      ptyRuntime: localPtyRuntime,
    })
    const connection = await controlSurfaceDisposable.ready

    ipcDisposable = registerIpcHandlers({
      approvedWorkspaces,
      ptyRuntime: createStandaloneMountAwarePtyRuntime({
        localRuntime: localPtyRuntime,
        endpointResolver: async () => ({
          hostname: connection.hostname,
          port: connection.port,
          token: connection.token,
        }),
      }),
    })
  } else {
    ipcDisposable = registerIpcHandlers({
      approvedWorkspaces,
      workerEndpointResolver,
    })
  }

  createWindow()

  app.on('activate', function () {
    // macOS: re-create a window when the dock icon is clicked and no windows are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (tests must exit on macOS, otherwise Playwright can leave Electron running).
app.on('window-all-closed', () => {
  if (process.env.NODE_ENV === 'test' || process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', event => {
  if (isCleaningUpOwnedLocalWorkerOnQuit || !hasOwnedLocalWorkerProcess()) {
    return
  }

  event.preventDefault()
  isCleaningUpOwnedLocalWorkerOnQuit = true
  void stopOwnedLocalWorker()
    .catch(() => undefined)
    .finally(() => {
      app.quit()
    })
})

app.on('will-quit', () => {
  ipcDisposable?.dispose()
  ipcDisposable = null

  void controlSurfaceDisposable?.dispose()
  controlSurfaceDisposable = null
})
