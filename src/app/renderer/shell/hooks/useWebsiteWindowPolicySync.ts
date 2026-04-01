import { useEffect } from 'react'
import type { WebsiteWindowPolicy } from '@shared/contracts/dto'

export function useWebsiteWindowPolicySync(policy: WebsiteWindowPolicy): void {
  useEffect(() => {
    const api = window.opencoveApi?.websiteWindow
    if (!api || typeof api.configurePolicy !== 'function') {
      return
    }

    void api.configurePolicy({ policy }).catch(() => undefined)
  }, [policy])
}
