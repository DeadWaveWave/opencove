import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

const MOBILE_SIDEBAR_QUERY = '(max-width: 720px)'

function subscribeToMobileLayout(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_SIDEBAR_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isMobileLayout(): boolean {
  return window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
}

/**
 * The primary sidebar's layout. On desktop it is docked or, collapsed, hidden entirely (no
 * rail left behind); the top bar's sidebar button and ⌘B toggle it. Narrow windows open it as a
 * drawer instead.
 */
export function usePrimarySidebar({
  isCollapsed,
  hasBlockingOverlay,
  onTogglePinned,
}: {
  isCollapsed: boolean
  hasBlockingOverlay: boolean
  onTogglePinned: () => void
}) {
  const isMobile = useSyncExternalStore(subscribeToMobileLayout, isMobileLayout, () => false)
  const [isDrawerOpen, setDrawerOpen] = useState(false)
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
    /** Whether the sidebar shows: the drawer is open, or the docked sidebar is not collapsed. */
    isOpen: isMobile ? isDrawerOpen : !isCollapsed,
    variant: isMobile || !isCollapsed ? ('docked' as const) : ('hidden' as const),
    close,
    toggle,
  }
}

export type PrimarySidebarController = ReturnType<typeof usePrimarySidebar>
