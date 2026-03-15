const OPENCODE_API_TIMEOUT_MS = 1_500
const OPENCODE_DISCOVERY_LIMIT = 20
const OPENCODE_DISCOVERY_WINDOW_MS = 20_000

type OpenCodeSessionStatus = 'busy' | 'retry' | 'idle'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value)
  }

  if (typeof value !== 'string') {
    return null
  }

  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : null
}

async function fetchOpenCodeJson(url: URL): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(OPENCODE_API_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OpenCode API request failed: ${response.status} ${response.statusText}`)
  }

  return await response.json()
}

function parseOpenCodeSessionIdCandidate(
  value: unknown,
): { sessionId: string; createdAtMs: number | null } | null {
  if (!isRecord(value)) {
    return null
  }

  const sessionId = typeof value.id === 'string' ? value.id.trim() : ''
  if (sessionId.length === 0) {
    return null
  }

  const createdAtMs = parseTimestampMs(
    value.created ?? (isRecord(value.time) ? value.time.created : null),
  )

  return {
    sessionId,
    createdAtMs,
  }
}

function normalizeOpenCodeStatus(value: unknown): OpenCodeSessionStatus | null {
  if (value === 'busy' || value === 'retry' || value === 'idle') {
    return value
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }

  return value.type === 'busy' || value.type === 'retry' || value.type === 'idle'
    ? value.type
    : null
}

export async function findOpenCodeSessionId({
  baseUrl,
  cwd,
  startedAtMs,
}: {
  baseUrl: string
  cwd: string
  startedAtMs: number
}): Promise<string | null> {
  try {
    const url = new URL('/session', baseUrl)
    url.searchParams.set('directory', cwd)
    url.searchParams.set('limit', String(OPENCODE_DISCOVERY_LIMIT))

    const payload = await fetchOpenCodeJson(url)
    if (!Array.isArray(payload)) {
      return null
    }

    const matchingSessionIds = new Set<string>()

    for (const item of payload) {
      const candidate = parseOpenCodeSessionIdCandidate(item)
      if (!candidate || candidate.createdAtMs === null) {
        continue
      }

      if (Math.abs(candidate.createdAtMs - startedAtMs) > OPENCODE_DISCOVERY_WINDOW_MS) {
        continue
      }

      matchingSessionIds.add(candidate.sessionId)
      if (matchingSessionIds.size > 1) {
        return null
      }
    }

    const [sessionId] = [...matchingSessionIds]
    return sessionId ?? null
  } catch {
    return null
  }
}

export async function readOpenCodeSessionStatus({
  baseUrl,
  cwd,
  sessionId,
}: {
  baseUrl: string
  cwd: string
  sessionId: string
}): Promise<OpenCodeSessionStatus | null> {
  const url = new URL('/session/status', baseUrl)
  url.searchParams.set('directory', cwd)

  const payload = await fetchOpenCodeJson(url)
  if (!isRecord(payload)) {
    return null
  }

  return normalizeOpenCodeStatus(payload[sessionId])
}
