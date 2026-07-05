import { useEffect } from 'react'

export function useAppDocumentChrome(activeWorkspaceName: string | null): void {
  useEffect(() => {
    document.title = activeWorkspaceName ? `${activeWorkspaceName} — OpenCove` : 'OpenCove'
  }, [activeWorkspaceName])

  const platform =
    typeof window !== 'undefined' && window.opencoveApi?.meta?.platform
      ? window.opencoveApi.meta.platform
      : undefined

  useEffect(() => {
    if (platform) {
      document.documentElement.dataset.covePlatform = platform
    }
  }, [platform])
}
