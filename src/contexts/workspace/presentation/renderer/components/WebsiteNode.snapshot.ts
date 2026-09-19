import { useEffect, useRef } from 'react'
import type { WebsiteWindowLifecycle } from '@shared/contracts/dto'

export function useWebsiteInitialSnapshot({
  nodeId,
  url,
  lifecycle,
  isLoading,
  snapshotDataUrl,
}: {
  nodeId: string
  url: string
  lifecycle: WebsiteWindowLifecycle
  isLoading: boolean
  snapshotDataUrl: string | null
}): void {
  const requested = useRef(false)
  useEffect(() => {
    if (lifecycle !== 'active') {
      requested.current = false
      return
    }
    if (!url.trim() || isLoading || snapshotDataUrl || requested.current) {
      return
    }
    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.captureSnapshot !== 'function') {
      return
    }
    requested.current = true
    api.captureSnapshot({ nodeId, quality: 60 })
  }, [isLoading, lifecycle, nodeId, snapshotDataUrl, url])
}
