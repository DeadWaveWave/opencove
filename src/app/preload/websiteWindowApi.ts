import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  ActivateWebsiteWindowInput,
  CaptureWebsiteWindowSnapshotInput,
  ConfigureWebsiteWindowPolicyInput,
  FindWebsiteWindowInput,
  NavigateWebsiteWindowInput,
  SetWebsiteWindowBoundsInput,
  SetWebsiteWindowOccludedInput,
  SetWebsiteWindowPinnedInput,
  SetWebsiteWindowSessionInput,
  WebsiteWindowEventPayload,
  WebsiteWindowNodeIdInput,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

type UnsubscribeFn = () => void

export function createWebsiteWindowPreloadApi(): {
  configurePolicy: (payload: ConfigureWebsiteWindowPolicyInput) => Promise<void>
  setOccluded: (payload: SetWebsiteWindowOccludedInput) => Promise<void>
  activate: (payload: ActivateWebsiteWindowInput) => Promise<void>
  deactivate: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  setBounds: (payload: SetWebsiteWindowBoundsInput) => void
  navigate: (payload: NavigateWebsiteWindowInput) => Promise<void>
  goBack: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  goForward: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  reload: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  stop: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  findInPage: (payload: FindWebsiteWindowInput) => Promise<void>
  stopFindInPage: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  close: (payload: WebsiteWindowNodeIdInput) => Promise<void>
  setPinned: (payload: SetWebsiteWindowPinnedInput) => Promise<void>
  setSession: (payload: SetWebsiteWindowSessionInput) => Promise<void>
  captureSnapshot: (payload: CaptureWebsiteWindowSnapshotInput) => void
  onEvent: (listener: (event: WebsiteWindowEventPayload) => void) => UnsubscribeFn
} {
  return {
    configurePolicy: payload => invokeIpc(IPC_CHANNELS.websiteWindowConfigurePolicy, payload),
    setOccluded: payload => invokeIpc(IPC_CHANNELS.websiteWindowSetOccluded, payload),
    activate: payload => invokeIpc(IPC_CHANNELS.websiteWindowActivate, payload),
    deactivate: payload => invokeIpc(IPC_CHANNELS.websiteWindowDeactivate, payload),
    setBounds: payload => {
      ipcRenderer.send(IPC_CHANNELS.websiteWindowSetBounds, payload)
    },
    navigate: payload => invokeIpc(IPC_CHANNELS.websiteWindowNavigate, payload),
    goBack: payload => invokeIpc(IPC_CHANNELS.websiteWindowGoBack, payload),
    goForward: payload => invokeIpc(IPC_CHANNELS.websiteWindowGoForward, payload),
    reload: payload => invokeIpc(IPC_CHANNELS.websiteWindowReload, payload),
    stop: payload => invokeIpc(IPC_CHANNELS.websiteWindowStop, payload),
    findInPage: payload => invokeIpc(IPC_CHANNELS.websiteWindowFindInPage, payload),
    stopFindInPage: payload => invokeIpc(IPC_CHANNELS.websiteWindowStopFindInPage, payload),
    close: payload => invokeIpc(IPC_CHANNELS.websiteWindowClose, payload),
    setPinned: payload => invokeIpc(IPC_CHANNELS.websiteWindowSetPinned, payload),
    setSession: payload => invokeIpc(IPC_CHANNELS.websiteWindowSetSession, payload),
    captureSnapshot: payload => {
      ipcRenderer.send(IPC_CHANNELS.websiteWindowCaptureSnapshot, payload)
    },
    onEvent: listener => {
      const handler = (_event: Electron.IpcRendererEvent, payload: WebsiteWindowEventPayload) => {
        listener(payload)
      }

      ipcRenderer.on(IPC_CHANNELS.websiteWindowEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.websiteWindowEvent, handler)
      }
    },
  }
}
