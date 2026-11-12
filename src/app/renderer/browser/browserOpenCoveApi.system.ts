import type {
  ListSystemFontsResult,
  SaveTextToDownloadsInput,
  SaveTextToDownloadsResult,
  ShowSystemNotificationInput,
  ShowSystemNotificationResult,
  SystemNotificationActivatedEvent,
} from '@shared/contracts/dto'
import { saveTextToDownloadsInBrowser } from './browserOpenCoveApi.downloads'

type ActivationListener = (event: SystemNotificationActivatedEvent) => void

/** The web client's system API: browser notifications, gated like main's on the foreground. */
export function createBrowserSystemApi() {
  const activationListeners = new Set<ActivationListener>()
  const liveNotifications = new Map<string, Notification>()

  return {
    listFonts: async (): Promise<ListSystemFontsResult> => ({ fonts: [] }),
    saveTextToDownloads: async (
      payload: SaveTextToDownloadsInput,
    ): Promise<SaveTextToDownloadsResult> => await saveTextToDownloadsInBrowser(payload),
    showNotification: async (
      payload: ShowSystemNotificationInput,
    ): Promise<ShowSystemNotificationResult> => {
      if (typeof window === 'undefined' || !('Notification' in window)) {
        return { shown: false }
      }
      // The page is the app here: a visible, focused tab already shows the in-app card.
      if (document.visibilityState === 'visible' && document.hasFocus()) {
        return { shown: false }
      }

      if (Notification.permission === 'default') {
        await Notification.requestPermission()
      }

      if (Notification.permission !== 'granted') {
        return { shown: false }
      }

      const title = payload.title.trim()
      if (title.length === 0) {
        return { shown: false }
      }

      if (payload.replacesId) {
        liveNotifications.get(payload.replacesId)?.close()
        liveNotifications.delete(payload.replacesId)
      }
      const notification = new Notification(title, {
        body: typeof payload.body === 'string' ? payload.body : undefined,
        silent: payload.silent ?? false,
      })
      const id = payload.id ?? null
      if (id) {
        liveNotifications.set(id, notification)
      }
      notification.onclick = () => {
        window.focus()
        notification.close()
        if (id) {
          liveNotifications.delete(id)
          activationListeners.forEach(listener => listener({ id }))
        }
      }
      return { shown: true }
    },
    onNotificationActivated: (listener: ActivationListener): (() => void) => {
      activationListeners.add(listener)
      return () => {
        activationListeners.delete(listener)
      }
    },
  }
}
