import { useCallback, useRef } from 'react'

export function useIgnoredPaneClick(): {
  ignoreNextPaneClickRef: React.MutableRefObject<boolean>
  queueIgnoreNextPaneClick: () => void
} {
  const ignoreNextPaneClickRef = useRef(false)

  const queueIgnoreNextPaneClick = useCallback(() => {
    ignoreNextPaneClickRef.current = true
    window.setTimeout(() => {
      ignoreNextPaneClickRef.current = false
    }, 0)
  }, [])

  return {
    ignoreNextPaneClickRef,
    queueIgnoreNextPaneClick,
  }
}
