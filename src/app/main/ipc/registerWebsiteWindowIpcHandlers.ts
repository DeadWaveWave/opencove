import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type {
  ActivateWebsiteWindowInput,
  CaptureWebsiteWindowSnapshotInput,
  ConfigureWebsiteWindowPolicyInput,
  NavigateWebsiteWindowInput,
  SetWebsiteWindowBoundsInput,
  SetWebsiteWindowOccludedInput,
  SetWebsiteWindowPinnedInput,
  SetWebsiteWindowSessionInput,
  WebsiteWindowNodeIdInput,
} from '../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from './types'
import { registerHandledIpc } from './handle'
import { WebsiteWindowManager } from '../websiteWindow/WebsiteWindowManager'

function normalizeNodeIdInput(payload: WebsiteWindowNodeIdInput): WebsiteWindowNodeIdInput {
  if (!payload || typeof payload.nodeId !== 'string') {
    throw new Error('Invalid website window payload')
  }

  const nodeId = payload.nodeId.trim()
  if (nodeId.length === 0) {
    throw new Error('Invalid website nodeId')
  }

  return { nodeId }
}

function resolveManager(event: IpcMainInvokeEvent | IpcMainEvent): WebsiteWindowManager {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow.isDestroyed()) {
    throw new Error('Unable to resolve BrowserWindow for website window request')
  }

  const existing =
    (targetWindow as unknown as { __opencoveWebsiteWindowManager?: WebsiteWindowManager })
      .__opencoveWebsiteWindowManager ?? null
  if (existing) {
    return existing
  }

  const nextManager = new WebsiteWindowManager(targetWindow)
  ;(
    targetWindow as unknown as { __opencoveWebsiteWindowManager?: WebsiteWindowManager }
  ).__opencoveWebsiteWindowManager = nextManager

  targetWindow.once('closed', () => {
    nextManager.dispose()
  })

  return nextManager
}

export function registerWebsiteWindowIpcHandlers(): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.websiteWindowConfigurePolicy,
    (event: IpcMainInvokeEvent, payload: ConfigureWebsiteWindowPolicyInput): void => {
      if (!payload || typeof payload !== 'object' || !('policy' in payload)) {
        throw new Error('Invalid website window policy payload')
      }

      resolveManager(event).configurePolicy(payload)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowSetOccluded,
    (event: IpcMainInvokeEvent, payload: SetWebsiteWindowOccludedInput): void => {
      if (!payload || typeof payload?.occluded !== 'boolean') {
        throw new Error('Invalid website window occlusion payload')
      }

      resolveManager(event).setOccluded(payload)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowActivate,
    (event: IpcMainInvokeEvent, payload: ActivateWebsiteWindowInput): void => {
      resolveManager(event).activate(payload)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowDeactivate,
    (event: IpcMainInvokeEvent, payload: WebsiteWindowNodeIdInput): void => {
      const normalized = normalizeNodeIdInput(payload)
      resolveManager(event).deactivate(normalized.nodeId)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowNavigate,
    (event: IpcMainInvokeEvent, payload: NavigateWebsiteWindowInput): void => {
      resolveManager(event).navigate(payload)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowGoBack,
    (event: IpcMainInvokeEvent, payload: WebsiteWindowNodeIdInput): void => {
      const normalized = normalizeNodeIdInput(payload)
      resolveManager(event).goBack(normalized.nodeId)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowGoForward,
    (event: IpcMainInvokeEvent, payload: WebsiteWindowNodeIdInput): void => {
      const normalized = normalizeNodeIdInput(payload)
      resolveManager(event).goForward(normalized.nodeId)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowReload,
    (event: IpcMainInvokeEvent, payload: WebsiteWindowNodeIdInput): void => {
      const normalized = normalizeNodeIdInput(payload)
      resolveManager(event).reload(normalized.nodeId)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowClose,
    (event: IpcMainInvokeEvent, payload: WebsiteWindowNodeIdInput): void => {
      const normalized = normalizeNodeIdInput(payload)
      resolveManager(event).close(normalized.nodeId)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowSetPinned,
    (event: IpcMainInvokeEvent, payload: SetWebsiteWindowPinnedInput): void => {
      resolveManager(event).setPinned(payload)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  registerHandledIpc(
    IPC_CHANNELS.websiteWindowSetSession,
    (event: IpcMainInvokeEvent, payload: SetWebsiteWindowSessionInput): void => {
      resolveManager(event).setSession(payload)
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  const handleSetBounds =
    typeof ipcMain.on === 'function' && typeof ipcMain.removeListener === 'function'
      ? (event: IpcMainEvent, payload: SetWebsiteWindowBoundsInput): void => {
          try {
            resolveManager(event).setBounds(payload)
          } catch {
            // ignore - bounds updates must never crash
          }
        }
      : null

  if (handleSetBounds) {
    ipcMain.on(IPC_CHANNELS.websiteWindowSetBounds, handleSetBounds)
  }

  const handleCaptureSnapshot =
    typeof ipcMain.on === 'function' && typeof ipcMain.removeListener === 'function'
      ? (event: IpcMainEvent, payload: CaptureWebsiteWindowSnapshotInput): void => {
          try {
            resolveManager(event).captureSnapshot(payload)
          } catch {
            // ignore - snapshot requests must never crash
          }
        }
      : null

  if (handleCaptureSnapshot) {
    ipcMain.on(IPC_CHANNELS.websiteWindowCaptureSnapshot, handleCaptureSnapshot)
  }

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowConfigurePolicy)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowSetOccluded)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowActivate)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowDeactivate)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowNavigate)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowGoBack)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowGoForward)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowReload)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowClose)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowSetPinned)
      ipcMain.removeHandler(IPC_CHANNELS.websiteWindowSetSession)
      if (handleSetBounds) {
        ipcMain.removeListener(IPC_CHANNELS.websiteWindowSetBounds, handleSetBounds)
      }
      if (handleCaptureSnapshot) {
        ipcMain.removeListener(IPC_CHANNELS.websiteWindowCaptureSnapshot, handleCaptureSnapshot)
      }
    },
  }
}
