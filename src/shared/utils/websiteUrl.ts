const ALLOWED_WEBSITE_PROTOCOLS = new Set(['http:', 'https:'])
const LIKELY_HOST_PATTERN =
  /^(localhost|(\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(?::\d{1,5})?(?:[/?#][^\s]*)?$/i

export function resolveWebsiteNavigationUrl(rawUrl: string): {
  url: string | null
  error: string | null
} {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    return { url: null, error: null }
  }

  try {
    const parsed = new URL(trimmed)
    if (!ALLOWED_WEBSITE_PROTOCOLS.has(parsed.protocol)) {
      return { url: null, error: `Unsupported protocol: ${parsed.protocol}` }
    }

    return { url: parsed.toString(), error: null }
  } catch {
    try {
      const parsed = new URL(`https://${trimmed}`)
      return { url: parsed.toString(), error: null }
    } catch {
      return { url: null, error: 'Invalid URL' }
    }
  }
}

export function isWebsiteUrlAllowedForNavigation(rawUrl: string): boolean {
  const resolved = resolveWebsiteNavigationUrl(rawUrl)
  return resolved.url !== null && resolved.error === null
}

export function resolveWebsitePasteUrl(rawUrl: string): {
  url: string | null
  error: string | null
} {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) {
    return { url: null, error: null }
  }

  if (/\s/.test(trimmed)) {
    return { url: null, error: 'Invalid URL' }
  }

  const normalizedLowercase = trimmed.toLowerCase()
  if (normalizedLowercase.startsWith('http://') || normalizedLowercase.startsWith('https://')) {
    return resolveWebsiteNavigationUrl(trimmed)
  }

  if (!LIKELY_HOST_PATTERN.test(trimmed)) {
    return { url: null, error: 'Invalid URL' }
  }

  return resolveWebsiteNavigationUrl(`https://${trimmed}`)
}
