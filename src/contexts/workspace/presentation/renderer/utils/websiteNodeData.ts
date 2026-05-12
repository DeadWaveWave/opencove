import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { NodeFrame, WebsiteNodeData } from '../types'

export function resolveDefaultBrowserMode(): BrowserMode {
  return typeof window !== 'undefined' &&
    typeof window.opencoveApi?.websiteWindow?.activate === 'function'
    ? 'native'
    : 'iframe'
}

export function createWebsiteNodeData(
  input: Partial<WebsiteNodeData> & { url?: string },
): WebsiteNodeData {
  const profileId =
    typeof input.profileId === 'string' && input.profileId.trim().length > 0
      ? input.profileId.trim()
      : null
  const sessionMode: WebsiteWindowSessionMode =
    input.sessionMode === 'incognito' || input.sessionMode === 'profile'
      ? input.sessionMode
      : 'shared'
  const effectiveSessionMode = sessionMode === 'profile' && !profileId ? 'shared' : sessionMode

  return {
    url: typeof input.url === 'string' ? input.url.trim() : '',
    pinned: input.pinned === true,
    sessionMode: effectiveSessionMode,
    profileId: effectiveSessionMode === 'profile' ? profileId : null,
    browserMode:
      input.browserMode === 'iframe'
        ? 'iframe'
        : (input.browserMode ?? resolveDefaultBrowserMode()),
    isFullscreen: input.isFullscreen === true,
    previousFrame: normalizeWebsiteNodeFrame(input.previousFrame),
  }
}

export function normalizeWebsiteNodeFrame(value: unknown): NodeFrame | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const position = record.position
  const size = record.size
  if (!position || typeof position !== 'object' || !size || typeof size !== 'object') {
    return null
  }

  const positionRecord = position as Record<string, unknown>
  const sizeRecord = size as Record<string, unknown>
  if (
    typeof positionRecord.x !== 'number' ||
    !Number.isFinite(positionRecord.x) ||
    typeof positionRecord.y !== 'number' ||
    !Number.isFinite(positionRecord.y) ||
    typeof sizeRecord.width !== 'number' ||
    !Number.isFinite(sizeRecord.width) ||
    typeof sizeRecord.height !== 'number' ||
    !Number.isFinite(sizeRecord.height) ||
    sizeRecord.width <= 0 ||
    sizeRecord.height <= 0
  ) {
    return null
  }

  return {
    position: { x: positionRecord.x, y: positionRecord.y },
    size: { width: sizeRecord.width, height: sizeRecord.height },
  }
}
