import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS = 140
const SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS = 420

export function usePrimarySidebarAutoReveal({ isCollapsed }: { isCollapsed: boolean }): {
  isPeekOpen: boolean
  handlePointerEnter: () => void
  handlePointerLeave: () => void
} {
  const [isPeekOpen, setIsPeekOpen] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearTimers = useCallback((): void => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    if (isCollapsed) {
      return
    }

    clearTimers()
    setIsPeekOpen(false)
  }, [clearTimers, isCollapsed])

  const handlePointerEnter = useCallback((): void => {
    if (!isCollapsed) {
      return
    }

    clearTimers()
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      setIsPeekOpen(true)
    }, SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS)
  }, [clearTimers, isCollapsed])

  const handlePointerLeave = useCallback((): void => {
    if (!isCollapsed) {
      return
    }

    clearTimers()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setIsPeekOpen(false)
    }, SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS)
  }, [clearTimers, isCollapsed])

  return { isPeekOpen, handlePointerEnter, handlePointerLeave }
}
