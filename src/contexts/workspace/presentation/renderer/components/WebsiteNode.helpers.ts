import type { WebsiteWindowBounds } from '@shared/contracts/dto'

export interface WebsiteViewportState {
  bounds: WebsiteWindowBounds
  canvasZoom: number
}

export const HIDDEN_WEBSITE_BOUNDS: WebsiteWindowBounds = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
}

function resolveViewportBounds(element: HTMLDivElement | null): WebsiteWindowBounds | null {
  if (!element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  if (
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return null
  }

  if (rect.width <= 0 || rect.height <= 0) {
    return null
  }

  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function intersectBounds(
  source: WebsiteWindowBounds,
  clip: WebsiteWindowBounds,
): WebsiteWindowBounds | null {
  const left = Math.max(source.x, clip.x)
  const top = Math.max(source.y, clip.y)
  const right = Math.min(source.x + source.width, clip.x + clip.width)
  const bottom = Math.min(source.y + source.height, clip.y + clip.height)

  if (right <= left || bottom <= top) {
    return null
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function normalizeBounds(bounds: WebsiteWindowBounds): WebsiteWindowBounds {
  const devicePixelRatio = window.devicePixelRatio
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1

  const leftPx = Number.isFinite(bounds.x) ? Math.floor(bounds.x * dpr) : 0
  const topPx = Number.isFinite(bounds.y) ? Math.floor(bounds.y * dpr) : 0
  const rightPx = Number.isFinite(bounds.x + bounds.width)
    ? Math.ceil((bounds.x + bounds.width) * dpr)
    : leftPx
  const bottomPx = Number.isFinite(bounds.y + bounds.height)
    ? Math.ceil((bounds.y + bounds.height) * dpr)
    : topPx

  return {
    x: leftPx / dpr,
    y: topPx / dpr,
    width: Math.max(0, (rightPx - leftPx) / dpr),
    height: Math.max(0, (bottomPx - topPx) / dpr),
  }
}

function resolveVisibleBounds(
  element: HTMLDivElement | null,
  rawBounds: WebsiteWindowBounds,
): WebsiteWindowBounds | null {
  const clipElement = element?.closest('.workspace-main')
  const clipRect =
    clipElement instanceof HTMLElement
      ? clipElement.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }

  return intersectBounds(rawBounds, {
    x: clipRect.left,
    y: clipRect.top,
    width: clipRect.width,
    height: clipRect.height,
  })
}

export function resolveViewportState(
  element: HTMLDivElement | null,
  canvasZoom: number,
): WebsiteViewportState | null {
  const rawBounds = resolveViewportBounds(element)
  if (!rawBounds) {
    return null
  }

  const visibleBounds = resolveVisibleBounds(element, rawBounds)
  if (!visibleBounds) {
    return null
  }

  return {
    bounds: normalizeBounds(visibleBounds),
    canvasZoom,
  }
}

function boundsEqual(a: WebsiteWindowBounds | null, b: WebsiteWindowBounds | null): boolean {
  if (!a || !b) {
    return a === b
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function viewportStateEqual(
  a: WebsiteViewportState | null,
  b: WebsiteViewportState | null,
): boolean {
  if (!a || !b) {
    return a === b
  }

  return boundsEqual(a.bounds, b.bounds) && a.canvasZoom === b.canvasZoom
}
