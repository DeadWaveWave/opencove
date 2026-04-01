import { session } from 'electron'
import type { Session } from 'electron'
import type { WebsiteWindowSessionMode } from '../../../shared/contracts/dto'

const WEBSITE_SHARED_PARTITION = 'persist:opencove-website-shared'
const WEBSITE_INCOGNITO_PARTITION = 'opencove-website-incognito'

function resolveProfilePartition(profileId: string): string {
  return `persist:opencove-website-profile-${profileId}`
}

export function resolveWebsiteSessionPartition({
  sessionMode,
  profileId,
}: {
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
}): string {
  if (sessionMode === 'incognito') {
    return WEBSITE_INCOGNITO_PARTITION
  }

  if (sessionMode === 'profile' && profileId) {
    return resolveProfilePartition(profileId)
  }

  return WEBSITE_SHARED_PARTITION
}

export function resolveWebsiteSession({
  sessionMode,
  profileId,
}: {
  sessionMode: WebsiteWindowSessionMode
  profileId: string | null
}): Session {
  return session.fromPartition(resolveWebsiteSessionPartition({ sessionMode, profileId }))
}
