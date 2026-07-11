import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS = 140
const SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS = 420

export function usePrimarySidebarAutoReveal({
  isCollapsed,
  isInteractionActive = false,
}: {
  isCollapsed: boolean
  isInteractionActive?: boolean
}): {
  isPeekOpen: boolean
  handlePointerEnter: () => void
  handlePointerLeave: () => void
} {
  const [isPeekOpen, setIsPeekOpen] = useState(false)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const isCollapsedRef = useRef(isCollapsed)
  const isInteractionActiveRef = useRef(isInteractionActive)
  const isPointerInsideRef = useRef(false)

  isCollapsedRef.current = isCollapsed
  isInteractionActiveRef.current = isInteractionActive

  const clearOpenTimer = useCallback((): void => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }, [])

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const clearTimers = useCallback((): void => {
    clearOpenTimer()
    clearCloseTimer()
  }, [clearCloseTimer, clearOpenTimer])

  const scheduleClose = useCallback((): void => {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (!isCollapsedRef.current || isPointerInsideRef.current || isInteractionActiveRef.current) {
        return
      }

      setIsPeekOpen(false)
    }, SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS)
  }, [clearCloseTimer])

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    if (!isCollapsed) {
      clearTimers()
      setIsPeekOpen(false)
      return
    }

    if (isInteractionActive) {
      clearTimers()
      setIsPeekOpen(true)
      return
    }

    if (isPeekOpen && !isPointerInsideRef.current) {
      scheduleClose()
    }
  }, [clearTimers, isCollapsed, isInteractionActive, isPeekOpen, scheduleClose])

  const handlePointerEnter = useCallback((): void => {
    isPointerInsideRef.current = true
    if (!isCollapsed) {
      return
    }

    clearTimers()
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null
      if (
        !isCollapsedRef.current ||
        (!isPointerInsideRef.current && !isInteractionActiveRef.current)
      ) {
        return
      }

      setIsPeekOpen(true)
    }, SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS)
  }, [clearTimers, isCollapsed])

  const handlePointerLeave = useCallback((): void => {
    isPointerInsideRef.current = false
    if (!isCollapsed) {
      return
    }

    clearOpenTimer()
    if (isInteractionActive) {
      clearCloseTimer()
      return
    }

    scheduleClose()
  }, [clearCloseTimer, clearOpenTimer, isCollapsed, isInteractionActive, scheduleClose])

  return { isPeekOpen, handlePointerEnter, handlePointerLeave }
}
