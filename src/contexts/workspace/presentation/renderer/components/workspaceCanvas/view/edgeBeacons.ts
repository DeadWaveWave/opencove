/** At most this many waiting windows get their own beacon; the rest fold into "+N". */
export const EDGE_BEACON_LIMIT = 5

export interface EdgeBeaconWindow {
  id: string
  title: string
  /** The window's frame in canvas screen px. */
  rect: { x: number; y: number; width: number; height: number }
}

export type EdgeBeaconSide = 'top' | 'right' | 'bottom' | 'left'

export interface EdgeBeacon {
  id: string
  title: string
  /** The beacon's centre in canvas screen px, on the inset frame. */
  x: number
  y: number
  side: EdgeBeaconSide
}

/**
 * Beacons for waiting windows that are entirely out of view (Tide EdgeBeacon): each sits where the
 * line from the view's centre to the window crosses a frame inset from the edges, nearest first.
 * Derived from state and viewport only; nothing is stored.
 */
export function resolveEdgeBeacons(
  windows: readonly EdgeBeaconWindow[],
  viewport: { width: number; height: number },
  inset: { x: number; y: number },
): {
  beacons: EdgeBeacon[]
  overflow: (Omit<EdgeBeacon, 'id' | 'title'> & { count: number; ids: string[] }) | null
} {
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  const halfWidth = Math.max(0, cx - inset.x)
  const halfHeight = Math.max(0, cy - inset.y)
  const offscreen = windows
    .filter(
      ({ rect }) =>
        rect.x + rect.width <= 0 ||
        rect.y + rect.height <= 0 ||
        rect.x >= viewport.width ||
        rect.y >= viewport.height,
    )
    .map(window => {
      const dx = window.rect.x + window.rect.width / 2 - cx
      const dy = window.rect.y + window.rect.height / 2 - cy
      return { window, dx, dy, distance: Math.hypot(dx, dy) }
    })
    .sort((left, right) => left.distance - right.distance)
  const place = (dx: number, dy: number): Omit<EdgeBeacon, 'id' | 'title'> => {
    const alongX = dx === 0 ? Infinity : halfWidth / Math.abs(dx)
    const alongY = dy === 0 ? Infinity : halfHeight / Math.abs(dy)
    const t = Math.min(alongX, alongY)
    const side: EdgeBeaconSide =
      alongX <= alongY ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top'
    return { x: cx + dx * t, y: cy + dy * t, side }
  }
  const beacons = offscreen.slice(0, EDGE_BEACON_LIMIT).map(({ window, dx, dy }) => ({
    id: window.id,
    title: window.title,
    ...place(dx, dy),
  }))
  const rest = offscreen.slice(EDGE_BEACON_LIMIT)
  if (rest.length === 0) {
    return { beacons, overflow: null }
  }
  const dx = rest.reduce((sum, entry) => sum + entry.dx, 0) / rest.length
  const dy = rest.reduce((sum, entry) => sum + entry.dy, 0) / rest.length
  return {
    beacons,
    overflow: { count: rest.length, ids: rest.map(entry => entry.window.id), ...place(dx, dy) },
  }
}
