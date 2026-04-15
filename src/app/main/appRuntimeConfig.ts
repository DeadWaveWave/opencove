import { app } from 'electron'
import { resolve } from 'path'
import { shouldEnableWaylandIme } from './waylandIme'

const APP_USER_DATA_DIRECTORY_NAME = 'opencove'

export type E2EWindowMode = 'normal' | 'inactive' | 'hidden' | 'offscreen'

export function isTruthyEnv(rawValue: string | undefined): boolean {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

export function configureAppCommandLine(): void {
  if (process.env['NODE_ENV'] === 'test') {
    // GitHub Actions macOS runners often treat the Electron window as
    // occluded/backgrounded even in "normal" mode, which can pause rAF/timers
    // and break pointer-driven E2E interactions.
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
}

function preserveCanonicalUserDataPath(): void {
  const appDataPath = app.getPath('appData')
  app.setPath('userData', resolve(appDataPath, APP_USER_DATA_DIRECTORY_NAME))
}

export function configureAppUserDataPath(): void {
  if (process.env.NODE_ENV !== 'test') {
    preserveCanonicalUserDataPath()
  }

  if (process.env.NODE_ENV === 'test' && process.env['OPENCOVE_TEST_USER_DATA_DIR']) {
    app.setPath('userData', resolve(process.env['OPENCOVE_TEST_USER_DATA_DIR']))
    return
  }

  if (app.isPackaged !== false) {
    return
  }

  const wantsSharedUserData =
    isTruthyEnv(process.env['OPENCOVE_DEV_USE_SHARED_USER_DATA']) ||
    process.argv.includes('--opencove-shared-user-data') ||
    process.argv.includes('--shared-user-data')

  if (wantsSharedUserData) {
    return
  }

  const explicitDevUserDataDir = process.env['OPENCOVE_DEV_USER_DATA_DIR']
  const defaultUserDataDir = app.getPath('userData')
  const devUserDataDir = explicitDevUserDataDir
    ? resolve(explicitDevUserDataDir)
    : `${defaultUserDataDir}-dev`

  app.setPath('userData', devUserDataDir)
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

export function resolveE2EWindowMode(): E2EWindowMode {
  if (process.env['NODE_ENV'] !== 'test') {
    return 'normal'
  }

  const explicitMode = parseE2EWindowMode(process.env['OPENCOVE_E2E_WINDOW_MODE'])
  if (explicitMode) {
    if (explicitMode === 'normal') {
      return 'inactive'
    }

    return explicitMode
  }

  if (isTruthyEnv(process.env['OPENCOVE_E2E_NO_FOCUS'])) {
    return 'inactive'
  }

  return 'offscreen'
}
