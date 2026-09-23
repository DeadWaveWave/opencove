import { useCallback, useLayoutEffect, useMemo } from 'react'

/** A directory visit owns its UI results, including when A → B → A uses the same URI. */
export function useDirectoryOperationScope(rootUri: string, mountId: string | null) {
  const scope = useMemo(() => ({ rootUri, mountId, active: false }), [rootUri, mountId])
  useLayoutEffect(() => {
    scope.active = true
    return () => {
      scope.active = false
    }
  }, [scope])
  return useCallback(() => scope.active, [scope])
}
