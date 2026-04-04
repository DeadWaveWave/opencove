function resolveHostnameFromHostHeader(hostHeader: string | null): string | null {
  if (!hostHeader) {
    return null
  }

  const trimmed = hostHeader.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.startsWith('[')) {
    const closingIndex = trimmed.indexOf(']')
    if (closingIndex > 1) {
      return trimmed.slice(1, closingIndex).trim().toLowerCase() || null
    }
  }

  return trimmed.split(':')[0]?.trim().toLowerCase() || null
}

export function shouldAllowDevWebUiOrigin(hostHeader: string | null): boolean {
  const hostname = resolveHostnameFromHostHeader(hostHeader)
  if (!hostname) {
    return true
  }

  if (hostname === 'localhost' || hostname === '::1') {
    return true
  }

  return hostname.startsWith('127.')
}
