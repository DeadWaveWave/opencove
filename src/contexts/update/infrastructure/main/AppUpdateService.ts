import { app, BrowserWindow } from 'electron'
import {
  autoUpdater,
  type AppUpdater,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from 'electron-updater'
import type {
  AppUpdateChannel,
  AppUpdatePolicy,
  AppUpdateState,
  AppUpdateStatus,
  ConfigureAppUpdatesInput,
} from '../../../../shared/contracts/dto'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

type DriverDisposer = () => void

interface AppUpdateDriver {
  configure(options: {
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
    allowPrerelease: boolean
    channel: string
  }): void
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): void
  onCheckingForUpdate(listener: () => void): DriverDisposer
  onUpdateAvailable(listener: (info: UpdateInfo) => void): DriverDisposer
  onUpdateNotAvailable(listener: (info: UpdateInfo) => void): DriverDisposer
  onDownloadProgress(listener: (progress: ProgressInfo) => void): DriverDisposer
  onUpdateDownloaded(listener: (info: UpdateDownloadedEvent) => void): DriverDisposer
  onError(listener: (error: Error) => void): DriverDisposer
}

export interface AppUpdateService {
  getState(): AppUpdateState
  configure(input: ConfigureAppUpdatesInput): Promise<AppUpdateState>
  checkForUpdates(): Promise<AppUpdateState>
  downloadUpdate(): Promise<AppUpdateState>
  installUpdate(): Promise<void>
  dispose(): void
}

interface AppUpdateServiceOptions {
  supportsUpdates?: boolean
  unsupportedMessage?: string
}

function channelToUpdaterChannel(channel: AppUpdateChannel): string {
  return channel === 'nightly' ? 'nightly' : 'latest'
}

function buildBaseState(
  currentVersion: string,
  policy: AppUpdatePolicy,
  channel: AppUpdateChannel,
  status: AppUpdateStatus,
  message: string | null = null,
): AppUpdateState {
  return {
    policy,
    channel,
    currentVersion,
    status,
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotesUrl: null,
    downloadPercent: null,
    downloadedBytes: null,
    totalBytes: null,
    checkedAt: null,
    message,
  }
}

function normalizeReleaseDate(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return value.toISOString()
  }

  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }

  return 'Unknown update error'
}

function createElectronAppUpdateDriver(updater: AppUpdater): AppUpdateDriver {
  const emitter = updater as unknown as {
    on: (event: string, listener: (...args: unknown[]) => void) => void
    removeListener: (event: string, listener: (...args: unknown[]) => void) => void
  }

  const listen = <T>(event: string, listener: (payload: T) => void): DriverDisposer => {
    const handler = (...args: unknown[]) => {
      listener(args[0] as T)
    }

    emitter.on(event, handler)
    return () => {
      emitter.removeListener(event, handler)
    }
  }

  const listenVoid = (event: string, listener: () => void): DriverDisposer => {
    emitter.on(event, listener)
    return () => {
      emitter.removeListener(event, listener)
    }
  }

  return {
    configure(options) {
      updater.autoDownload = options.autoDownload
      updater.autoInstallOnAppQuit = options.autoInstallOnAppQuit
      updater.allowPrerelease = options.allowPrerelease
      updater.channel = options.channel
    },
    async checkForUpdates() {
      await updater.checkForUpdates()
    },
    async downloadUpdate() {
      await updater.downloadUpdate()
    },
    quitAndInstall() {
      updater.quitAndInstall()
    },
    onCheckingForUpdate(listener) {
      return listenVoid('checking-for-update', listener)
    },
    onUpdateAvailable(listener) {
      return listen<UpdateInfo>('update-available', listener)
    },
    onUpdateNotAvailable(listener) {
      return listen<UpdateInfo>('update-not-available', listener)
    },
    onDownloadProgress(listener) {
      return listen<ProgressInfo>('download-progress', listener)
    },
    onUpdateDownloaded(listener) {
      return listen<UpdateDownloadedEvent>('update-downloaded', listener)
    },
    onError(listener) {
      return listen<Error>('error', listener)
    },
  }
}

export function createAppUpdateService(
  driver: AppUpdateDriver = createElectronAppUpdateDriver(autoUpdater),
  options: AppUpdateServiceOptions = {},
): AppUpdateService {
  const currentVersion = app.getVersion()
  const unsupportedMessage =
    options.unsupportedMessage ??
    (process.env.NODE_ENV === 'test'
      ? 'Update checks are disabled in tests.'
      : 'Update checks are only available in packaged builds.')
  const supportsUpdates =
    options.supportsUpdates ?? (process.env.NODE_ENV !== 'test' && app.isPackaged)
  let state = buildBaseState(
    currentVersion,
    'prompt',
    'stable',
    supportsUpdates ? 'idle' : 'unsupported',
    supportsUpdates ? null : unsupportedMessage,
  )
  let intervalId: ReturnType<typeof setInterval> | null = null
  let activeCheckPromise: Promise<void> | null = null
  let activeDownloadPromise: Promise<void> | null = null

  const emitState = (): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.appUpdateState, state)
    }
  }

  const applyState = (nextState: AppUpdateState): AppUpdateState => {
    state = nextState
    emitState()
    return state
  }

  const clearSchedule = (): void => {
    if (!intervalId) {
      return
    }

    clearInterval(intervalId)
    intervalId = null
  }

  const resetConfiguredState = (status: AppUpdateStatus, message: string | null = null): void => {
    applyState(buildBaseState(currentVersion, state.policy, state.channel, status, message))
  }

  const scheduleChecks = (): void => {
    clearSchedule()
    if (!supportsUpdates || state.policy === 'off') {
      return
    }

    intervalId = setInterval(() => {
      void service.checkForUpdates()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  const driverDisposers = [
    driver.onCheckingForUpdate(() => {
      applyState({
        ...buildBaseState(currentVersion, state.policy, state.channel, 'checking'),
        checkedAt: state.checkedAt,
      })
    }),
    driver.onUpdateAvailable(info => {
      applyState({
        ...buildBaseState(currentVersion, state.policy, state.channel, 'available'),
        latestVersion: info.version ?? null,
        releaseName: info.releaseName ?? null,
        releaseDate: normalizeReleaseDate(info.releaseDate),
        checkedAt: new Date().toISOString(),
      })
    }),
    driver.onUpdateNotAvailable(_info => {
      applyState({
        ...buildBaseState(currentVersion, state.policy, state.channel, 'up_to_date'),
        checkedAt: new Date().toISOString(),
      })
    }),
    driver.onDownloadProgress(progress => {
      applyState({
        ...state,
        status: 'downloading',
        downloadPercent: Number.isFinite(progress.percent) ? progress.percent : null,
        downloadedBytes: Number.isFinite(progress.transferred) ? progress.transferred : null,
        totalBytes: Number.isFinite(progress.total) ? progress.total : null,
      })
    }),
    driver.onUpdateDownloaded(info => {
      applyState({
        ...state,
        status: 'downloaded',
        latestVersion: info.version ?? state.latestVersion,
        releaseName: info.releaseName ?? state.releaseName,
        releaseDate: normalizeReleaseDate(info.releaseDate) ?? state.releaseDate,
        downloadPercent: 100,
        downloadedBytes: state.totalBytes,
        checkedAt: new Date().toISOString(),
      })
    }),
    driver.onError(error => {
      applyState({
        ...buildBaseState(
          currentVersion,
          state.policy,
          state.channel,
          'error',
          normalizeMessage(error),
        ),
        checkedAt: new Date().toISOString(),
        latestVersion: state.latestVersion,
        releaseName: state.releaseName,
        releaseDate: state.releaseDate,
      })
    }),
  ]

  const service: AppUpdateService = {
    getState() {
      return state
    },
    async configure(input) {
      const normalizedPolicy =
        input.channel === 'nightly' && input.policy === 'auto' ? 'prompt' : input.policy
      state = {
        ...state,
        policy: normalizedPolicy,
        channel: input.channel,
      }

      clearSchedule()

      if (!supportsUpdates) {
        return applyState({
          ...buildBaseState(
            currentVersion,
            input.policy,
            input.channel,
            'unsupported',
            unsupportedMessage,
          ),
        })
      }

      if (normalizedPolicy === 'off') {
        return applyState(
          buildBaseState(currentVersion, normalizedPolicy, input.channel, 'disabled'),
        )
      }

      driver.configure({
        autoDownload: normalizedPolicy === 'auto',
        autoInstallOnAppQuit: normalizedPolicy === 'auto',
        allowPrerelease: input.channel === 'nightly',
        channel: channelToUpdaterChannel(input.channel),
      })

      resetConfiguredState('idle')
      scheduleChecks()
      void service.checkForUpdates()
      return state
    },
    async checkForUpdates() {
      if (!supportsUpdates) {
        return state
      }

      if (state.policy === 'off' || state.status === 'downloaded') {
        return state
      }

      if (activeCheckPromise) {
        await activeCheckPromise
        return state
      }

      activeCheckPromise = driver.checkForUpdates().finally(() => {
        activeCheckPromise = null
      })

      await activeCheckPromise
      return state
    },
    async downloadUpdate() {
      if (!supportsUpdates) {
        return state
      }

      if (state.status !== 'available') {
        return state
      }

      if (activeDownloadPromise) {
        await activeDownloadPromise
        return state
      }

      applyState({
        ...state,
        status: 'downloading',
        downloadPercent: 0,
        downloadedBytes: 0,
        totalBytes: null,
      })

      activeDownloadPromise = driver.downloadUpdate().finally(() => {
        activeDownloadPromise = null
      })

      await activeDownloadPromise
      return state
    },
    async installUpdate() {
      if (state.status !== 'downloaded') {
        return
      }

      driver.quitAndInstall()
    },
    dispose() {
      clearSchedule()
      for (const dispose of driverDisposers) {
        dispose()
      }
    },
  }

  return service
}
