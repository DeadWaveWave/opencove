import type { WebsiteWindowBounds } from '../../../shared/contracts/dto'

export function normalizeBounds(bounds: WebsiteWindowBounds): WebsiteWindowBounds {
  const x = Number.isFinite(bounds.x) ? bounds.x : 0
  const y = Number.isFinite(bounds.y) ? bounds.y : 0
  const width = Number.isFinite(bounds.width) ? Math.max(0, bounds.width) : 0
  const height = Number.isFinite(bounds.height) ? Math.max(0, bounds.height) : 0

  return { x, y, width, height }
}

export function boundsEqual(a: WebsiteWindowBounds | null, b: WebsiteWindowBounds | null): boolean {
  if (!a || !b) {
    return a === b
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
