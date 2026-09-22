import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS = 140
const SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS = 420

type PointerPosition = {
  clientX: number
  clientY: number
}

function isPointerPositionInsideSidebar(position: PointerPosition): boolean {
  const sidebar = document.querySelector<HTMLElement>('.workspace-sidebar')
  const rect = sidebar?.getBoundingClientRect()
  return (
    rect !== undefined &&
    position.clientX >= rect.left &&
    position.clientX < rect.right &&
    position.clientY >= rect.top &&
    position.clientY < rect.bottom
  )
}

export function usePrimarySidebarAutoReveal({
  isCollapsed,
  isInteractionActive = false,
}: {
  isCollapsed: boolean
  isInteractionActive?: boolean
}): {
  isPeekOpen: boolean
  handlePointerEnter: () => void
  handlePointerLeave: (position?: PointerPosition) => void
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
    if (closeTimerRef.current !== null) {
      return
    }
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (!isCollapsedRef.current || isPointerInsideRef.current || isInteractionActiveRef.current) {
        return
      }
      setIsPeekOpen(false)
    }, SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS)
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  useEffect(() => {
    if (!isCollapsed) {
      clearTimers()
      setIsPeekOpen(false)
    } else if (isInteractionActive) {
      clearTimers()
      setIsPeekOpen(true)
    } else if (isPeekOpen && !isPointerInsideRef.current) {
      scheduleClose()
    }
  }, [clearTimers, isCollapsed, isInteractionActive, isPeekOpen, scheduleClose])

  const handlePointerLeave = useCallback(
    (position?: PointerPosition): void => {
      // A portal can generate a DOM leave without leaving the visible panel.
      isPointerInsideRef.current = position ? isPointerPositionInsideSidebar(position) : false
      if (isPointerInsideRef.current) {
        clearCloseTimer()
        return
      }
      clearOpenTimer()
      if (!isCollapsedRef.current || isInteractionActiveRef.current) {
        clearCloseTimer()
        return
      }
      scheduleClose()
    },
    [clearCloseTimer, clearOpenTimer, scheduleClose],
  )

  useEffect(() => {
    if (!isCollapsed || !isPeekOpen) {
      return
    }

    // Only the project icon initiates a peek. Once open, the entire navigation
    // panel keeps it open, including when a portal covers the pointer. Menu
    // dismissal (click or keyboard) never overrides the current hover location.
    const trackPointer = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') {
        handlePointerLeave(event)
      }
    }
    window.addEventListener('pointermove', trackPointer, true)
    window.addEventListener('pointerdown', trackPointer, true)
    window.addEventListener('pointerup', trackPointer, true)
    return () => {
      window.removeEventListener('pointermove', trackPointer, true)
      window.removeEventListener('pointerdown', trackPointer, true)
      window.removeEventListener('pointerup', trackPointer, true)
    }
  }, [handlePointerLeave, isCollapsed, isPeekOpen])

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

  return { isPeekOpen, handlePointerEnter, handlePointerLeave }
}
