import type { BrowserProfileScopeInput } from '../../../shared/contracts/dto'

export const DEFAULT_BROWSER_HOME_URL = 'https://www.google.com/'

export function resolveBrowserProfileKey(scope: BrowserProfileScopeInput): string {
  if (scope.sessionMode === 'profile') {
    const normalizedProfileId = scope.profileId?.trim() ?? ''
    if (normalizedProfileId.length > 0) {
      return `profile:${normalizedProfileId}`
    }
  }

  return 'shared'
}

export function shouldPersistPassiveBrowserData(scope: BrowserProfileScopeInput): boolean {
  return scope.sessionMode !== 'incognito'
}
