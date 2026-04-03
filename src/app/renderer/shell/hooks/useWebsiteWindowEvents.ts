import { useEffect } from 'react'
import type { WebsiteWindowEventPayload } from '@shared/contracts/dto'
import { useWebsiteWindowStore } from '@contexts/workspace/presentation/renderer/store/useWebsiteWindowStore'
import { WEBSITE_WINDOW_OPEN_URL_EVENT_NAME } from '@shared/contracts/websiteWindowCanvas'

export function useWebsiteWindowEvents(): void {
  useEffect(() => {
    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.onEvent !== 'function') {
      return
    }

    const unsubscribe = api.onEvent((event: WebsiteWindowEventPayload) => {
      if (event.type === 'open-url') {
        window.dispatchEvent(
          new CustomEvent(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, {
            detail: event,
          }),
        )
        return
      }

      useWebsiteWindowStore.getState().applyEvent(event)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])
}
