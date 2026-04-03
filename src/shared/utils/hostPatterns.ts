function normalizeHost(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeHostPattern(value: string): string | null {
  const trimmed = normalizeHost(value)
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.startsWith('*.')) {
    const suffix = trimmed.slice(2)
    return suffix.length > 0 ? `*.${suffix}` : null
  }

  return trimmed
}

export function matchesHostPattern(host: string, pattern: string): boolean {
  const normalizedHost = normalizeHost(host)
  const normalizedPattern = normalizeHost(pattern)

  if (normalizedPattern.length === 0 || normalizedHost.length === 0) {
    return false
  }

  if (!normalizedPattern.startsWith('*.')) {
    return normalizedHost === normalizedPattern
  }

  const suffix = normalizedPattern.slice(2)
  if (suffix.length === 0) {
    return false
  }

  if (normalizedHost === suffix) {
    return false
  }

  return normalizedHost.endsWith(`.${suffix}`)
}

export function matchesAnyHostPattern({
  url,
  patterns,
}: {
  url: string
  patterns: string[]
}): boolean {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const host = normalizeHost(parsed.hostname)
  if (host.length === 0) {
    return false
  }

  for (const raw of patterns) {
    const pattern = normalizeHostPattern(raw)
    if (!pattern) {
      continue
    }

    if (matchesHostPattern(host, pattern)) {
      return true
    }
  }

  return false
}
