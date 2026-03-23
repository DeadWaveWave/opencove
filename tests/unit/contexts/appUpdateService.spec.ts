import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.2.0'),
    isPackaged: true,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {},
}))

type ListenerMap = {
  'checking-for-update': Array<() => void>
  'update-available': Array<(info: UpdateInfo) => void>
  'update-not-available': Array<(info: UpdateInfo) => void>
  'download-progress': Array<(progress: ProgressInfo) => void>
  'update-downloaded': Array<(info: UpdateDownloadedEvent) => void>
  error: Array<(error: Error) => void>
}

function createDriver() {
  const listeners: ListenerMap = {
    'checking-for-update': [],
    'update-available': [],
    'update-not-available': [],
    'download-progress': [],
    'update-downloaded': [],
    error: [],
  }

  return {
    configure: vi.fn(),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    onCheckingForUpdate(listener: () => void) {
      listeners['checking-for-update'].push(listener)
      return () => undefined
    },
    onUpdateAvailable(listener: (info: UpdateInfo) => void) {
      listeners['update-available'].push(listener)
      return () => undefined
    },
    onUpdateNotAvailable(listener: (info: UpdateInfo) => void) {
      listeners['update-not-available'].push(listener)
      return () => undefined
    },
    onDownloadProgress(listener: (progress: ProgressInfo) => void) {
      listeners['download-progress'].push(listener)
      return () => undefined
    },
    onUpdateDownloaded(listener: (info: UpdateDownloadedEvent) => void) {
      listeners['update-downloaded'].push(listener)
      return () => undefined
    },
    onError(listener: (error: Error) => void) {
      listeners.error.push(listener)
      return () => undefined
    },
    emitCheckingForUpdate() {
      listeners['checking-for-update'].forEach(listener => listener())
    },
    emitUpdateAvailable(info: UpdateInfo) {
      listeners['update-available'].forEach(listener => listener(info))
    },
    emitDownloadProgress(progress: ProgressInfo) {
      listeners['download-progress'].forEach(listener => listener(progress))
    },
    emitUpdateDownloaded(info: UpdateDownloadedEvent) {
      listeners['update-downloaded'].forEach(listener => listener(info))
    },
  }
}

describe('AppUpdateService', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('configures the updater channel and automatic download policy', async () => {
    const driver = createDriver()
    const { createAppUpdateService } =
      await import('../../../src/contexts/update/infrastructure/main/AppUpdateService')
    const service = createAppUpdateService(driver, { supportsUpdates: true })

    await service.configure({ policy: 'auto', channel: 'nightly' })

    expect(driver.configure).toHaveBeenCalledWith({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: true,
      channel: 'nightly',
    })
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(service.getState().policy).toBe('prompt')
    expect(service.getState().channel).toBe('nightly')
  })

  it('keeps update checks disabled when the policy is off', async () => {
    const driver = createDriver()
    const { createAppUpdateService } =
      await import('../../../src/contexts/update/infrastructure/main/AppUpdateService')
    const service = createAppUpdateService(driver, { supportsUpdates: true })

    const state = await service.configure({ policy: 'off', channel: 'stable' })

    expect(state.status).toBe('disabled')
    expect(driver.configure).not.toHaveBeenCalled()
    expect(driver.checkForUpdates).not.toHaveBeenCalled()
  })

  it('tracks available, downloading, and downloaded states', async () => {
    const driver = createDriver()
    const { createAppUpdateService } =
      await import('../../../src/contexts/update/infrastructure/main/AppUpdateService')
    const service = createAppUpdateService(driver, { supportsUpdates: true })

    await service.configure({ policy: 'prompt', channel: 'stable' })
    driver.emitUpdateAvailable({
      version: '0.2.1',
      files: [],
      path: '',
      sha512: '',
      releaseDate: '2026-03-20T00:00:00.000Z',
    } satisfies UpdateInfo)

    expect(service.getState().status).toBe('available')
    expect(service.getState().latestVersion).toBe('0.2.1')

    const downloadPromise = service.downloadUpdate()
    driver.emitDownloadProgress({
      bytesPerSecond: 2048,
      percent: 42,
      transferred: 42,
      total: 100,
    } satisfies ProgressInfo)

    expect(service.getState().status).toBe('downloading')
    expect(service.getState().downloadPercent).toBe(42)

    driver.emitUpdateDownloaded({
      version: '0.2.1',
      files: [],
      path: '',
      sha512: '',
      releaseDate: '2026-03-20T00:00:00.000Z',
    } satisfies UpdateDownloadedEvent)
    await downloadPromise

    expect(service.getState().status).toBe('downloaded')
    expect(service.getState().latestVersion).toBe('0.2.1')
  })
})
