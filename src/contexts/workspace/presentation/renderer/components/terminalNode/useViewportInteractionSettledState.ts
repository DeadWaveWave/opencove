import { useEffect, useState } from 'react'
import { VIEWPORT_INTERACTION_SETTLE_MS } from '../workspaceCanvas/constants'

export function useViewportInteractionSettledState(isInteractionActive: boolean): boolean {
  const [settledState, setSettledState] = useState(isInteractionActive)

  useEffect(() => {
    if (isInteractionActive) {
      setSettledState(true)
      return undefined
    }

    const timer = window.setTimeout(() => {
      setSettledState(false)
    }, VIEWPORT_INTERACTION_SETTLE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isInteractionActive])

  return settledState
}
