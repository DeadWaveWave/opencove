import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { hydrateCliPathForPackagedApp } from '../../platform/os/CliEnvironment'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import { setRuntimeIconTestState } from './iconTestHarness'
import { resolveRuntimeIconPath } from './runtimeIcon'

let ipcDisposable: ReturnType<typeof registerIpcHandlers> | null = null
const APP_USER_DATA_DIRECTORY_NAME = 'opencove'
const OPENCOVE_APP_USER_MODEL_ID = 'dev.deadwave.opencove'

if (process.env['NODE_ENV'] === 'test') {
  // GitHub Actions macOS runners often treat the Electron window as occluded/backgrounded even in
  // "normal" mode, which can pause rAF/timers and break pointer-driven E2E interactions.
  // These Chromium switches keep the renderer responsive in such environments.
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
  // Native window occlusion can throttle/pause rAF in headful CI environments (notably macOS).
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

const EXTERNAL_PROTOCOL_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])
const E2E_OFFSCREEN_COORDINATE = -50_000
type E2EWindowMode = 'normal' | 'inactive' | 'hidden' | 'offscreen'

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
    ...(runtimeIconPath ? { icon: runtimeIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !disableRendererSandboxForTests,
      ...(keepRendererActiveInBackground ? { backgroundThrottling: false } : {}),
    },
  })

  mainWindow.on('ready-to-show', () => {
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
app.whenReady().then(() => {
  hydrateCliPathForPackagedApp(app.isPackaged === true)

  // Set app user model id for windows
  electronApp.setAppUserModelId(OPENCOVE_APP_USER_MODEL_ID)

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const runtimeIconPath = resolveRuntimeIconPath()
  if (process.platform === 'darwin' && runtimeIconPath) {
    app.dock?.setIcon(nativeImage.createFromPath(runtimeIconPath))
  }

  ipcDisposable = registerIpcHandlers()

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
  if (process.env.NODE_ENV === 'test' || process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  ipcDisposable?.dispose()
  ipcDisposable = null
})
