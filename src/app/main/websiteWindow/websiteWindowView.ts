import type { DownloadItem, Session, WebContents, WebContentsView } from 'electron'
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

export function configureWebsiteSessionPermissions({
  configuredSessions,
  session,
  onPermissionCheck,
  onPermissionRequest,
  onDownload,
}: {
  configuredSessions: WeakSet<Session>
  session: Session
  onPermissionCheck?: (contents: WebContents | null, permission: string, origin: string) => boolean
  onPermissionRequest?: (
    contents: WebContents,
    permission: string,
    origin: string,
    callback: (granted: boolean) => void,
  ) => void
  onDownload?: (contents: WebContents, item: DownloadItem) => void
}): void {
  if (configuredSessions.has(session)) {
    return
  }

  configuredSessions.add(session)

  session.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return onPermissionCheck?.(contents, permission, requestingOrigin) === true
  })

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin =
      typeof details.requestingUrl === 'string' && details.requestingUrl.length > 0
        ? details.requestingUrl
        : contents.getURL()
    if (onPermissionRequest) {
      onPermissionRequest(contents, permission, origin, callback)
      return
    }

    callback(false)
  })

  session.on('will-download', (_event, item, contents) => {
    onDownload?.(contents, item)
  })
}

export function configureWebsiteViewAppearance(view: WebContentsView): void {
  view.setBackgroundColor(WEBSITE_VIEW_BACKGROUND)
  view.setBorderRadius(WEBSITE_VIEW_BORDER_RADIUS)
}
