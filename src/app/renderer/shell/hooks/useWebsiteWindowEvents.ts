import { useEffect } from 'react'
import type { WebsiteWindowEventPayload } from '@shared/contracts/dto'
import { useWebsiteWindowStore } from '@contexts/workspace/presentation/renderer/store/useWebsiteWindowStore'

export function useWebsiteWindowEvents(): void {
  useEffect(() => {
    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.onEvent !== 'function') {
      return
    }

    const unsubscribe = api.onEvent((event: WebsiteWindowEventPayload) => {
      useWebsiteWindowStore.getState().applyEvent(event)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])
}
