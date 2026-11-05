import React, { useState } from 'react'
import { ShellWallLayerContext } from '../shellWallLayer'

/**
 * The app shell's root. Its first child is the wall layer the canvas paints its pixel wall
 * into, so the wall fills the window and the top bar and sidebar float on it (Tide).
 */
export function AppShellFrame({
  isSidebarCollapsed,
  sidebar,
  children,
}: {
  isSidebarCollapsed: boolean
  sidebar: { isPeekOpen: boolean; isMobile: boolean }
  children: React.ReactNode
}): React.JSX.Element {
  const [wallLayer, setWallLayer] = useState<HTMLDivElement | null>(null)
  return (
    <div
      className={`app-shell ${isSidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}${sidebar.isPeekOpen ? ' app-shell--sidebar-peek' : ''}${sidebar.isMobile ? ' app-shell--mobile-navigation' : ''}`}
    >
      <div ref={setWallLayer} className="app-shell__wall" aria-hidden="true" />
      <ShellWallLayerContext.Provider value={wallLayer}>{children}</ShellWallLayerContext.Provider>
    </div>
  )
}
