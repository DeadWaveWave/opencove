import type { Session, WebContentsView } from 'electron'
import type { WebsiteWindowSessionMode } from '../../../shared/contracts/dto'
import { resolveWebsiteSession, resolveWebsiteSessionPartition } from './websiteWindowSessions'

const WEBSITE_VIEW_BORDER_RADIUS = 13
const WEBSITE_VIEW_BACKGROUND = '#00000000'
const WEBSITE_VIEW_MIN_CANVAS_ZOOM = 0.1
const WEBSITE_VIEW_MAX_CANVAS_ZOOM = 2

export function normalizeWebsiteCanvasZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1
  }

  return Math.max(WEBSITE_VIEW_MIN_CANVAS_ZOOM, Math.min(WEBSITE_VIEW_MAX_CANVAS_ZOOM, value))
}

export function resolveWebsiteViewBorderRadius(canvasZoom: unknown): number {
  const zoom = normalizeWebsiteCanvasZoom(canvasZoom)
  return Math.round(WEBSITE_VIEW_BORDER_RADIUS * zoom)
}

export function resolveWebsiteViewPartition({
  sessionMode,
  profileId,
}: {
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
}): { partition: string; session: Session } {
  const partition = resolveWebsiteSessionPartition({ sessionMode, profileId })
  return { partition, session: resolveWebsiteSession({ sessionMode, profileId }) }
}

export function configureWebsiteSessionPermissions(
  configuredSessions: WeakSet<Session>,
  session: Session,
): void {
  if (configuredSessions.has(session)) {
    return
  }

  configuredSessions.add(session)

  session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
}

export function configureWebsiteViewAppearance(view: WebContentsView): void {
  view.setBackgroundColor(WEBSITE_VIEW_BACKGROUND)
  view.setBorderRadius(WEBSITE_VIEW_BORDER_RADIUS)
}
