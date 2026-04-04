import { useEffect } from 'react'

export function useWebsiteWindowOcclusionSync(occluded: boolean): void {
  useEffect(() => {
    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.setOccluded !== 'function') {
      return
    }

    void api.setOccluded({ occluded }).catch(() => undefined)
  }, [occluded])
}
