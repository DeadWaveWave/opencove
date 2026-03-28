export function resolveDocumentTitleFromUri(uri: string, fallbackTitle: string): string {
  const normalized = uri.trim()
  if (normalized.length === 0) {
    return fallbackTitle
  }

  try {
    const parsed = new URL(normalized)
    const pathname = parsed.pathname ?? ''
    const segments = pathname.split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1] ?? ''
    const decoded = lastSegment.length > 0 ? decodeURIComponent(lastSegment) : ''
    return decoded.length > 0 ? decoded : fallbackTitle
  } catch {
    return fallbackTitle
  }
}
