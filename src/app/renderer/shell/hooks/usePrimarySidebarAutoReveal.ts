import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS = 140
const SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS = 420

export function usePrimarySidebarAutoReveal({
  isCollapsed,
  isInteractionActive = false,
  isMenuOpen = false,
}: {
  isCollapsed: boolean
  isInteractionActive?: boolean
  /**
   * Whether the interaction lock comes from the sidebar context menu. A
   * pointer action inside the menu should keep the peek open for the next
   * interaction even after the menu dismisses.
   */
  isMenuOpen?: boolean
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
  const previousInteractionActiveRef = useRef(isInteractionActive)
  const menuActionRef = useRef(false)
  const postMenuActionHeldRef = useRef(false)
  const [isPostMenuActionHeld, setIsPostMenuActionHeld] = useState(false)

  isCollapsedRef.current = isCollapsed
  isInteractionActiveRef.current = isInteractionActive

  // Context menu actions are rendered in a portal. Remember pointer presses
  // that happen inside that menu so closing the menu after an action does not
  // immediately collapse the sidebar underneath the pointer.
  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handleMenuPress = (event: Event): void => {
      const target = event.target
      menuActionRef.current =
        target instanceof Element && target.closest('.workspace-context-menu') !== null
    }
    window.addEventListener('pointerdown', handleMenuPress, true)
    window.addEventListener('mousedown', handleMenuPress, true)
    return () => {
      window.removeEventListener('pointerdown', handleMenuPress, true)
      window.removeEventListener('mousedown', handleMenuPress, true)
    }
  }, [isMenuOpen])

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
    const wasInteractionActive = previousInteractionActiveRef.current
    previousInteractionActiveRef.current = isInteractionActive

    if (!isCollapsed) {
      clearTimers()
      postMenuActionHeldRef.current = false
      setIsPostMenuActionHeld(false)
      setIsPeekOpen(false)
      return
    }

    if (isInteractionActive) {
      clearTimers()
      postMenuActionHeldRef.current = false
      setIsPostMenuActionHeld(false)
      setIsPeekOpen(true)
      return
    }

    // A menu command dismisses the portal immediately after its pointer press.
    // Keep the revealed rail visible until the pointer moves again, so the
    // command does not make the sidebar disappear under the user's cursor.
    if (
      wasInteractionActive &&
      menuActionRef.current &&
      isPeekOpen &&
      !isPointerInsideRef.current
    ) {
      menuActionRef.current = false
      clearTimers()
      postMenuActionHeldRef.current = true
      isPointerInsideRef.current = true
      setIsPostMenuActionHeld(true)
      return
    }

    if (isPostMenuActionHeld) {
      return
    }

    if (isPeekOpen && !isPointerInsideRef.current) {
      scheduleClose()
    }
  }, [
    clearTimers,
    isCollapsed,
    isInteractionActive,
    isPeekOpen,
    isPostMenuActionHeld,
    menuActionRef,
    scheduleClose,
  ])

  useEffect(() => {
    if (!isPostMenuActionHeld) {
      return
    }

    const handlePointerMove = (): void => {
      postMenuActionHeldRef.current = false
      isPointerInsideRef.current = false
      setIsPostMenuActionHeld(false)
      scheduleClose()
    }
    window.addEventListener('pointermove', handlePointerMove, true)
    return () => window.removeEventListener('pointermove', handlePointerMove, true)
  }, [isPostMenuActionHeld, scheduleClose])

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
    if (postMenuActionHeldRef.current) {
      return
    }
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
