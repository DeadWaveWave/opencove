import type { Session, WebContentsView } from 'electron'
import type { WebsiteWindowSessionMode } from '../../../shared/contracts/dto'
import { resolveWebsiteSession, resolveWebsiteSessionPartition } from './websiteWindowSessions'

const WEBSITE_VIEW_BORDER_RADIUS = 0
const WEBSITE_VIEW_BACKGROUND = '#00000000'

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
