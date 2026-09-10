import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { usePrimarySidebarAutoReveal } from './usePrimarySidebarAutoReveal'

const MOBILE_SIDEBAR_QUERY = '(max-width: 720px)'

function subscribeToMobileLayout(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_SIDEBAR_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isMobileLayout(): boolean {
  return window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
}

export function usePrimarySidebar({
  isCollapsed,
  isMenuOpen,
  hasBlockingOverlay,
  onTogglePinned,
}: {
  isCollapsed: boolean
  isMenuOpen: boolean
  hasBlockingOverlay: boolean
  onTogglePinned: () => void
}) {
  const isMobile = useSyncExternalStore(subscribeToMobileLayout, isMobileLayout, () => false)
  const [isDrawerOpen, setDrawerOpen] = useState(false)
  const [isDragging, setDragging] = useState(false)
  const autoReveal = usePrimarySidebarAutoReveal({
    isCollapsed: isCollapsed && !isMobile,
    isInteractionActive: isMenuOpen || isDragging,
  })
  const close = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => {
    close()
  }, [close, isMobile])

  useEffect(() => {
    if (hasBlockingOverlay) {
      close()
    }
  }, [close, hasBlockingOverlay])

  const toggle = useCallback(() => {
    if (isMobile) {
      setDrawerOpen(previous => !previous)
    } else {
      onTogglePinned()
    }
  }, [isMobile, onTogglePinned])

  return {
    isMobile,
    isDrawerOpen,
    isPeekOpen: autoReveal.isPeekOpen,
    variant:
      isMobile || !isCollapsed
        ? ('docked' as const)
        : autoReveal.isPeekOpen
          ? ('peek' as const)
          : ('rail' as const),
    close,
    toggle,
    setDragging,
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') {
        autoReveal.handlePointerEnter()
      }
    },
    onPointerLeave: autoReveal.handlePointerLeave,
  }
}

export type PrimarySidebarController = ReturnType<typeof usePrimarySidebar>
