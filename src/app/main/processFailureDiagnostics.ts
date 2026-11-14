import { app, type BrowserWindow } from 'electron'
import { freemem, totalmem } from 'node:os'
import type { RuntimeDiagnosticsDetailValue } from '../../shared/contracts/dto'

type Context = Record<string, RuntimeDiagnosticsDetailValue>

function bestEffort<T>(read: () => T): T | null {
  try {
    return read()
  } catch {
    return null
  }
}

export function getProcessFailureContext(): Context {
  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron ?? null,
    chromeVersion: process.versions.chrome ?? null,
    mainPid: process.pid,
    mainRssBytes: process.memoryUsage().rss,
    systemFreeMemoryBytes: freemem(),
    systemTotalMemoryBytes: totalmem(),
    // This is an exit-time snapshot; the dead process may already be absent.
    processMetricsAtExit: bestEffort(() =>
      JSON.stringify(
        app.getAppMetrics().map(({ pid, type, creationTime, memory }) => ({
          pid,
          type,
          creationTime,
          memory,
        })),
      ),
    ),
    gpuFeatureStatus: bestEffort(() => JSON.stringify(app.getGPUFeatureStatus())),
  }
}

export function createRendererFailureContext(window: BrowserWindow): () => Context {
  const contents = window.webContents
  const createdAt = Date.now()
  const webContentsId = contents.id
  let rendererPid: number | null = null
  let lastLifecycleEvent = 'created'
  let completedLoads = 0
  const recordLifecycle = (event: string) => (): void => {
    lastLifecycleEvent = event
    if (event === 'did-finish-load') {
      completedLoads += 1
    }
    const pid = bestEffort(() => contents.getOSProcessId())
    if (pid && pid > 0) {
      rendererPid = pid
    }
  }
  const onStartLoading = recordLifecycle('did-start-loading')
  const onDomReady = recordLifecycle('dom-ready')
  const onFinishLoad = recordLifecycle('did-finish-load')
  const onStopLoading = recordLifecycle('did-stop-loading')
  contents.on('did-start-loading', onStartLoading)
  contents.on('dom-ready', onDomReady)
  contents.on('did-finish-load', onFinishLoad)
  contents.on('did-stop-loading', onStopLoading)
  contents.on('destroyed', () => {
    contents.removeListener('did-start-loading', onStartLoading)
    contents.removeListener('dom-ready', onDomReady)
    contents.removeListener('did-finish-load', onFinishLoad)
    contents.removeListener('did-stop-loading', onStopLoading)
  })

  return () => ({
    ...getProcessFailureContext(),
    webContentsId,
    rendererPid,
    windowAgeMs: Date.now() - createdAt,
    lastLifecycleEvent,
    completedLoads,
    loading: bestEffort(() => contents.isLoading()),
    windowVisible: bestEffort(() => window.isVisible()),
    windowFocused: bestEffort(() => window.isFocused()),
  })
}
