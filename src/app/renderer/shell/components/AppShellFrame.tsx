import React, { useMemo, useState } from 'react'
import { ShellWallCoverContext, ShellWallLayerContext } from '../shellWallLayer'

/**
 * The app shell's root. Its first child is the wall layer the canvas paints its pixel wall
 * into, so the wall fills the window and the top bar and sidebar float on it (Tide). It also
 * holds whether a sheet covers the canvas, which the settings page sets while it is open.
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
  const [covered, setCovered] = useState(false)
  const cover = useMemo(() => ({ covered, setCovered }), [covered])
  return (
    <div
      className={`app-shell ${isSidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}${sidebar.isPeekOpen ? ' app-shell--sidebar-peek' : ''}${sidebar.isMobile ? ' app-shell--mobile-navigation' : ''}`}
    >
      <div ref={setWallLayer} className="app-shell__wall" aria-hidden="true" />
      <ShellWallLayerContext.Provider value={wallLayer}>
        <ShellWallCoverContext.Provider value={cover}>{children}</ShellWallCoverContext.Provider>
      </ShellWallLayerContext.Provider>
    </div>
  )
}
