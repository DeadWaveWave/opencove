import type { BrowserMode } from '@shared/contracts/dto'
import { resolveWebsitePasteUrl } from '@shared/utils/websiteUrl'

export type BrowserSearchEngineId = 'google' | 'duckduckgo' | 'bing' | 'brave'

export const BROWSER_SEARCH_ENGINES: BrowserSearchEngineId[] = [
  'google',
  'duckduckgo',
  'bing',
  'brave',
]

export const DEFAULT_BROWSER_SEARCH_ENGINE: BrowserSearchEngineId = 'google'
export const DEFAULT_BROWSER_MODE: BrowserMode = 'native'

const SEARCH_URL_BY_ENGINE: Record<BrowserSearchEngineId, string> = {
  google: 'https://www.google.com/search?igu=1&q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
}

export function isValidBrowserMode(value: unknown): value is BrowserMode {
  return value === 'native' || value === 'iframe'
}

export function normalizeBrowserMode(value: unknown, fallback: BrowserMode): BrowserMode {
  return isValidBrowserMode(value) ? value : fallback
}

export function isValidBrowserSearchEngineId(value: unknown): value is BrowserSearchEngineId {
  return (
    typeof value === 'string' && BROWSER_SEARCH_ENGINES.includes(value as BrowserSearchEngineId)
  )
}

export function normalizeBrowserSearchEngineId(
  value: unknown,
  fallback: BrowserSearchEngineId,
): BrowserSearchEngineId {
  return isValidBrowserSearchEngineId(value) ? value : fallback
}

export function resolveBrowserSearchUrl(
  query: string,
  engine: BrowserSearchEngineId,
): string | null {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length === 0) {
    return null
  }

  return `${SEARCH_URL_BY_ENGINE[engine]}${encodeURIComponent(normalizedQuery)}`
}

export function resolveBrowserNavigationTarget(
  input: string,
  engine: BrowserSearchEngineId,
): string | null {
  const normalizedInput = input.trim()
  if (normalizedInput.length === 0) {
    return ''
  }

  const resolvedUrl = resolveWebsitePasteUrl(normalizedInput)
  if (resolvedUrl.url) {
    return resolvedUrl.url
  }

  return resolveBrowserSearchUrl(normalizedInput, engine)
}
