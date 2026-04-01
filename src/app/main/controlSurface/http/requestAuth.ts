import type { IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { WebSessionManager } from './webSessionManager'

function normalizeBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const token = trimmed.slice('bearer '.length).trim()
  return token.length > 0 ? token : null
}

function tokensEqual(a: string, b: string): boolean {
  // Avoid leaking token length timing.
  const aBytes = Buffer.from(a, 'utf8')
  const bBytes = Buffer.from(b, 'utf8')
  if (aBytes.length !== bBytes.length) {
    return false
  }

  return timingSafeEqual(aBytes, bBytes)
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {}
  }

  const parts = header.split(';')
  if (parts.length === 0) {
    return {}
  }

  const cookies: Record<string, string> = {}
  for (const part of parts) {
    const [rawKey, ...rest] = part.split('=')
    const key = rawKey?.trim()
    if (!key) {
      continue
    }

    const value = rest.join('=').trim()
    if (!value) {
      continue
    }

    cookies[key] = value
  }

  return cookies
}

function resolveOriginHeader(req: IncomingMessage): string | null {
  const raw = req.headers.origin
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveRefererHeader(req: IncomingMessage): string | null {
  const raw = req.headers.referer
  if (typeof raw !== 'string') {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function matchesHostHeader(candidateUrl: string, hostRaw: string): boolean {
  try {
    const parsed = new URL(candidateUrl)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === hostRaw
  } catch {
    return false
  }
}

function isSameOriginRequest(req: IncomingMessage): boolean {
  const originRaw = resolveOriginHeader(req)
  const hostRaw = typeof req.headers.host === 'string' ? req.headers.host.trim() : ''
  if (hostRaw.length === 0) {
    return false
  }

  if (originRaw) {
    return matchesHostHeader(originRaw, hostRaw)
  }

  const refererRaw = resolveRefererHeader(req)
  if (refererRaw) {
    return matchesHostHeader(refererRaw, hostRaw)
  }

  const fetchSiteRaw = req.headers['sec-fetch-site'] as string | string[] | undefined
  let fetchSite = ''
  if (typeof fetchSiteRaw === 'string') {
    fetchSite = fetchSiteRaw.trim().toLowerCase()
  } else if (Array.isArray(fetchSiteRaw)) {
    fetchSite = fetchSiteRaw[0]?.trim().toLowerCase() ?? ''
  }

  return fetchSite === 'same-origin' || fetchSite === 'none'
}

export type RequestAuth =
  | {
      kind: 'bearer'
    }
  | {
      kind: 'cookie'
    }
  | {
      kind: 'query_token'
    }

export function resolveRequestAuth(options: {
  req: IncomingMessage
  url: URL
  token: string
  webSessions: WebSessionManager
  allowQueryToken: boolean
  now: Date
}): RequestAuth | null {
  const bearer = normalizeBearerToken(options.req.headers.authorization)
  if (bearer && tokensEqual(bearer, options.token)) {
    return { kind: 'bearer' }
  }

  const cookies = parseCookies(
    typeof options.req.headers.cookie === 'string' ? options.req.headers.cookie : undefined,
  )
  const sessionCookie = cookies[options.webSessions.cookieName()]
  if (sessionCookie && options.webSessions.validateCookie(options.now, sessionCookie)) {
    if (!isSameOriginRequest(options.req)) {
      return null
    }

    return { kind: 'cookie' }
  }

  if (options.allowQueryToken) {
    const queryToken = options.url.searchParams.get('token')?.trim() ?? null
    if (queryToken && tokensEqual(queryToken, options.token)) {
      return { kind: 'query_token' }
    }
  }

  return null
}
