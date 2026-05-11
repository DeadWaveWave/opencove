import { WebContentsView } from 'electron'
import type { DownloadItem, Session, WebContents } from 'electron'
import type { WebsiteWindowEventPayload } from '../../../shared/contracts/dto'
import type { WebsiteWindowRuntime } from './websiteWindowRuntime'
import { disposeWebsiteWindowDeviceMetrics } from './websiteWindowDeviceMetrics'
import {
  configureWebsiteViewAppearance,
  configureWebsiteSessionPermissions,
  resolveWebsiteViewPartition,
} from './websiteWindowView'
import {
  configureWebsiteWebContents,
  registerWebsiteWebContentsRuntimeListeners,
} from './websiteWindowWebContents'

export function ensureWebsiteWindowView({
  runtime,
  configuredSessions,
  emitState,
  emit,
  flushPendingSnapshot,
  recordHistoryVisit,
  onPermissionCheck,
  onPermissionRequest,
  onDownload,
}: {
  runtime: WebsiteWindowRuntime
  configuredSessions: WeakSet<Session>
  emitState: (runtime: WebsiteWindowRuntime) => void
  emit: (payload: WebsiteWindowEventPayload) => void
  flushPendingSnapshot: (runtime: WebsiteWindowRuntime) => void
  recordHistoryVisit?: (runtime: WebsiteWindowRuntime) => void
  onPermissionCheck?: (contents: WebContents | null, permission: string, origin: string) => boolean
  onPermissionRequest?: (
    contents: WebContents,
    permission: string,
    origin: string,
    callback: (granted: boolean) => void,
  ) => void
  onDownload?: (contents: WebContents, item: DownloadItem) => void
}): void {
  if (runtime.view) {
    try {
      if (!runtime.view.webContents.isDestroyed()) {
        return
      }
    } catch {
      // fallthrough
    }

    if (runtime.hostView) {
      try {
        runtime.hostView.removeChildView(runtime.view)
      } catch {
        // ignore - host/view may already be gone during shutdown
      }
    }

    try {
      disposeWebsiteWindowDeviceMetrics({ runtime, contents: runtime.view.webContents })
    } catch {
      runtime.deviceMetricsDebuggerAttached = false
      runtime.deviceMetricsScaleFactor = null
      runtime.deviceMetricsWidth = null
      runtime.deviceMetricsHeight = null
      runtime.deviceMetricsVersion += 1
    }

    runtime.scrollbarCssKey = null
    runtime.scrollbarCssSizePx = null
    runtime.scrollbarCssVersion += 1
    runtime.view = null
  }

  const { partition, session } = resolveWebsiteViewPartition({
    sessionMode: runtime.sessionMode,
    profileId: runtime.profileId,
  })

  configureWebsiteSessionPermissions({
    configuredSessions,
    session,
    onPermissionCheck,
    onPermissionRequest,
    onDownload,
  })

  const view = new WebContentsView({
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  configureWebsiteViewAppearance(view)
  configureWebContents(runtime.nodeId, view.webContents, emit)

  runtime.view = view
  runtime.disposeWebContentsListeners = registerWebsiteWebContentsRuntimeListeners({
    runtime,
    contents: view.webContents,
    emitState: nextRuntime => {
      emitState(nextRuntime)
    },
    emit: payload => {
      emit(payload)
    },
    flushPendingSnapshot: nextRuntime => {
      flushPendingSnapshot(nextRuntime)
    },
    recordHistoryVisit,
  })
}

function configureWebContents(
  nodeId: string,
  contents: WebContents,
  emit: (payload: WebsiteWindowEventPayload) => void,
): void {
  configureWebsiteWebContents({
    nodeId,
    contents,
    emit: payload => {
      emit(payload)
    },
  })
}
