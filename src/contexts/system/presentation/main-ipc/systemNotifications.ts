import { execFile } from 'node:child_process'
import { BrowserWindow, Notification } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  ShowSystemNotificationInput,
  ShowSystemNotificationResult,
  SystemNotificationActivatedEvent,
} from '../../../../shared/contracts/dto'

const NOTIFY_SEND_TIMEOUT_MS = 5_000
// Shown notifications stay referenced so their click handler outlives garbage collection.
const MAX_LIVE_NOTIFICATIONS = 20

type RecordedSystemNotification = {
  id: string | null
  title: string
  body: string | null
  silent: boolean
  replacesId: string | null
}

/** E2E: notifications are recorded instead of shown, and a test can pretend focus and click. */
export type SystemNotificationTestState = {
  /** null asks the windows; true or false pretends OpenCove is or is not in the foreground. */
  foreground: boolean | null
  shown: RecordedSystemNotification[]
  click: (id: string) => boolean
}

declare global {
  var __opencoveSystemNotificationTestState: SystemNotificationTestState | undefined
}

const liveNotifications = new Map<string, { close: () => void }>()
const testClickHandlers = new Map<string, () => void>()

export function installSystemNotificationTestHarness(): void {
  globalThis.__opencoveSystemNotificationTestState ??= {
    foreground: null,
    shown: [],
    click: id => {
      const handler = testClickHandlers.get(id)
      handler?.()
      return handler !== undefined
    },
  }
}

function listAppWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(window => !window.isDestroyed())
}

/** The foreground gate: the renderer's own focus signals are unreliable, the windows are not. */
function isAppInForeground(): boolean {
  const pretended = globalThis.__opencoveSystemNotificationTestState?.foreground
  if (typeof pretended === 'boolean') {
    return pretended
  }
  return listAppWindows().some(window => window.isFocused())
}

function activateNotification(id: string | null): void {
  const windows = listAppWindows()
  const target = windows[0]
  if (target) {
    if (target.isMinimized()) {
      target.restore()
    }
    target.show()
    target.focus()
  }
  if (!id) {
    return
  }

  const event: SystemNotificationActivatedEvent = { id }
  windows.forEach(window => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.systemNotificationActivated, event)
    }
  })
}

function retain(id: string, notification: { close: () => void }): void {
  liveNotifications.set(id, notification)
  if (liveNotifications.size > MAX_LIVE_NOTIFICATIONS) {
    const oldest = liveNotifications.keys().next().value
    if (oldest !== undefined) {
      liveNotifications.delete(oldest)
    }
  }
}

function showWithNotifySend(
  payload: ShowSystemNotificationInput,
): Promise<ShowSystemNotificationResult> {
  const args: string[] = []
  if (payload.silent) {
    args.push('--urgency=low')
  }
  args.push(payload.title)
  if (payload.body) {
    args.push(payload.body)
  }

  return new Promise<ShowSystemNotificationResult>(resolve => {
    execFile('notify-send', args, { timeout: NOTIFY_SEND_TIMEOUT_MS, windowsHide: true }, error => {
      resolve({ shown: error === null })
    })
  })
}

export async function showSystemNotification(
  payload: ShowSystemNotificationInput,
): Promise<ShowSystemNotificationResult> {
  if (isAppInForeground()) {
    return { shown: false }
  }

  const id = payload.id ?? null
  if (payload.replacesId) {
    liveNotifications.get(payload.replacesId)?.close()
    liveNotifications.delete(payload.replacesId)
  }

  const testState = globalThis.__opencoveSystemNotificationTestState
  if (testState) {
    testState.shown.push({
      id,
      title: payload.title,
      body: payload.body ?? null,
      silent: payload.silent ?? false,
      replacesId: payload.replacesId ?? null,
    })
    if (id) {
      testClickHandlers.set(id, () => activateNotification(id))
    }
    return { shown: true }
  }

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: payload.title,
      ...(payload.body ? { body: payload.body } : {}),
      silent: payload.silent ?? false,
    })

    notification.once('click', () => {
      if (id) {
        liveNotifications.delete(id)
      }
      activateNotification(id)
    })
    if (id) {
      retain(id, notification)
    }
    notification.show()

    return { shown: true }
  }

  if (process.platform === 'linux') {
    return await showWithNotifySend(payload)
  }

  return { shown: false }
}
