const ALLOWED_WEBSITE_PROTOCOLS = new Set(['http:', 'https:'])

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
