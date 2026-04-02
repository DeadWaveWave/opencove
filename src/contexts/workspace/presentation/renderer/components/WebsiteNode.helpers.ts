import type { WebsiteWindowBounds } from '@shared/contracts/dto'

export interface WebsiteViewportState {
  bounds: WebsiteWindowBounds
  viewportBounds: WebsiteWindowBounds
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

function resolveWorkspaceBounds(element: HTMLDivElement | null): WebsiteWindowBounds | null {
  const workspaceMain = document.querySelector('.workspace-main')
  const clipElement =
    workspaceMain instanceof HTMLElement ? workspaceMain : element?.closest('.workspace-main')
  let clipRect =
    clipElement instanceof HTMLElement
      ? clipElement.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }

  const appHeader = document.querySelector('.app-header')
  if (appHeader instanceof HTMLElement) {
    const headerRect = appHeader.getBoundingClientRect()
    const bottom = clipRect.top + clipRect.height
    const headerBottom = headerRect.top + headerRect.height
    if (Number.isFinite(headerBottom) && headerBottom > clipRect.top) {
      clipRect = {
        ...clipRect,
        top: headerBottom,
        height: bottom - headerBottom,
      }
    }
  }

  const workspaceSidebar = document.querySelector('.workspace-sidebar')
  if (workspaceSidebar instanceof HTMLElement) {
    const sidebarRect = workspaceSidebar.getBoundingClientRect()
    const right = clipRect.left + clipRect.width
    const sidebarRight = sidebarRect.left + sidebarRect.width
    if (Number.isFinite(sidebarRight) && sidebarRight > clipRect.left) {
      clipRect = {
        ...clipRect,
        left: sidebarRight,
        width: right - sidebarRight,
      }
    }
  }

  if (
    !Number.isFinite(clipRect.left) ||
    !Number.isFinite(clipRect.top) ||
    !Number.isFinite(clipRect.width) ||
    !Number.isFinite(clipRect.height)
  ) {
    return null
  }

  if (clipRect.width <= 0 || clipRect.height <= 0) {
    return null
  }

  return {
    x: clipRect.left,
    y: clipRect.top,
    width: clipRect.width,
    height: clipRect.height,
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

export function resolveViewportState(
  element: HTMLDivElement | null,
  canvasZoom: number,
): WebsiteViewportState | null {
  const rawViewportBounds = resolveViewportBounds(element)
  if (!rawViewportBounds) {
    return null
  }

  const rawWorkspaceBounds = resolveWorkspaceBounds(element)
  if (!rawWorkspaceBounds) {
    return null
  }

  const viewportBounds = normalizeBounds(rawViewportBounds)
  const workspaceBounds = normalizeBounds(rawWorkspaceBounds)
  const visibleBounds = intersectBounds(viewportBounds, workspaceBounds)
  if (!visibleBounds) {
    return null
  }

  return {
    bounds: visibleBounds,
    viewportBounds,
    canvasZoom,
  }
}

export function resolveViewportFocusRatio(element: HTMLDivElement | null): number | null {
  const viewportBounds = resolveViewportBounds(element)
  if (!viewportBounds) {
    return null
  }

  const workspaceBounds = resolveWorkspaceBounds(element)
  if (!workspaceBounds) {
    return null
  }

  const viewportCenterX = viewportBounds.x + viewportBounds.width / 2
  const viewportCenterY = viewportBounds.y + viewportBounds.height / 2
  const workspaceCenterX = workspaceBounds.x + workspaceBounds.width / 2
  const workspaceCenterY = workspaceBounds.y + workspaceBounds.height / 2

  const halfWorkspaceWidth = workspaceBounds.width / 2
  const halfWorkspaceHeight = workspaceBounds.height / 2
  if (halfWorkspaceWidth <= 0 || halfWorkspaceHeight <= 0) {
    return null
  }

  const ratioX = Math.abs(viewportCenterX - workspaceCenterX) / halfWorkspaceWidth
  const ratioY = Math.abs(viewportCenterY - workspaceCenterY) / halfWorkspaceHeight

  return Math.max(ratioX, ratioY)
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

  return (
    boundsEqual(a.bounds, b.bounds) &&
    boundsEqual(a.viewportBounds, b.viewportBounds) &&
    a.canvasZoom === b.canvasZoom
  )
}
