import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_AUTO_REVEAL_OPEN_DELAY_MS = 140
const SIDEBAR_AUTO_REVEAL_CLOSE_DELAY_MS = 420

type PointerPosition = {
  clientX: number
  clientY: number
}

function isPointerPositionInsideSidebar(position: PointerPosition | null): boolean {
  if (position === null) {
    return false
  }

  const sidebar = document.querySelector<HTMLElement>('[data-testid="workspace-sidebar"]')
  const rect = sidebar?.getBoundingClientRect()
  return (
    rect !== undefined &&
    position.clientX >= rect.left &&
    position.clientX <= rect.right &&
    position.clientY >= rect.top &&
    position.clientY <= rect.bottom
  )
}

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
  const menuActionPositionRef = useRef<PointerPosition | null>(null)
  const menuActionResetTimerRef = useRef<number | null>(null)
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
      if (!(target instanceof Element) || target.closest('.workspace-context-menu') === null) {
        return
      }

      menuActionRef.current = true
      menuActionPositionRef.current = null
      if ('clientX' in event && 'clientY' in event) {
        const clientX = event.clientX
        const clientY = event.clientY
        if (typeof clientX === 'number' && typeof clientY === 'number') {
          menuActionPositionRef.current = { clientX, clientY }
        }
      }

      if (menuActionResetTimerRef.current !== null) {
        window.clearTimeout(menuActionResetTimerRef.current)
      }
      menuActionResetTimerRef.current = window.setTimeout(() => {
        menuActionResetTimerRef.current = null
        if (document.querySelector('.workspace-context-menu') !== null) {
          menuActionRef.current = false
          menuActionPositionRef.current = null
        }
      }, 0)
    }
    window.addEventListener('pointerdown', handleMenuPress, true)
    window.addEventListener('mousedown', handleMenuPress, true)
    return () => {
      window.removeEventListener('pointerdown', handleMenuPress, true)
      window.removeEventListener('mousedown', handleMenuPress, true)
      if (menuActionResetTimerRef.current !== null) {
        window.clearTimeout(menuActionResetTimerRef.current)
        menuActionResetTimerRef.current = null
      }
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
      menuActionRef.current = false
      menuActionPositionRef.current = null
      postMenuActionHeldRef.current = false
      setIsPostMenuActionHeld(false)
      setIsPeekOpen(false)
      return
    }

    if (isInteractionActive) {
      clearTimers()
      // A color/icon action can re-render the still-open menu. It should not
      // be mistaken for the later action that actually dismisses the menu.
      menuActionRef.current = false
      menuActionPositionRef.current = null
      postMenuActionHeldRef.current = false
      setIsPostMenuActionHeld(false)
      setIsPeekOpen(true)
      return
    }

    // A menu command dismisses the portal immediately after its pointer press.
    // Use the action coordinates to decide whether the pointer is still over
    // the Sidebar. This avoids collapsing the peek just because the portal
    // menu disappeared underneath a cursor that is still over the Sidebar.
    if (wasInteractionActive && menuActionRef.current) {
      menuActionRef.current = false
      const actionPosition = menuActionPositionRef.current
      menuActionPositionRef.current = null

      if (!isPeekOpen) {
        return
      }

      clearTimers()
      const isActionInsideSidebar =
        actionPosition === null
          ? isPointerInsideRef.current
          : isPointerPositionInsideSidebar(actionPosition)
      isPointerInsideRef.current = isActionInsideSidebar
      postMenuActionHeldRef.current = isActionInsideSidebar
      setIsPostMenuActionHeld(isActionInsideSidebar)
      if (!isActionInsideSidebar) {
        scheduleClose()
      }
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

    const handlePointerMove = (event: PointerEvent): void => {
      const isInsideSidebar = isPointerPositionInsideSidebar({
        clientX: event.clientX,
        clientY: event.clientY,
      })

      if (isInsideSidebar) {
        postMenuActionHeldRef.current = false
        isPointerInsideRef.current = true
        clearCloseTimer()
        setIsPostMenuActionHeld(false)
        return
      }

      postMenuActionHeldRef.current = false
      isPointerInsideRef.current = false
      setIsPostMenuActionHeld(false)
      scheduleClose()
    }
    window.addEventListener('pointermove', handlePointerMove, true)
    return () => window.removeEventListener('pointermove', handlePointerMove, true)
  }, [clearCloseTimer, isPostMenuActionHeld, scheduleClose])

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
