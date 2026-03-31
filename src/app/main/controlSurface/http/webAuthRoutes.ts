import type { ServerResponse } from 'node:http'
import {
  buildWebSessionCookieHeader,
  buildWebSessionClearCookieHeader,
  type WebSessionManager,
  WEB_SESSION_MAX_AGE_SECONDS,
} from './webSessionManager'

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(`${message}\n`)
}

export function tryHandleWebAuthRoutes(options: {
  res: ServerResponse
  url: URL
  now: () => Date
  webSessions: WebSessionManager
}): boolean {
  const { res, url, now, webSessions } = options

  if (url.pathname === '/auth/claim') {
    const ticket = url.searchParams.get('ticket')?.trim() ?? null
    if (!ticket) {
      sendText(res, 400, 'Missing ticket.')
      return true
    }

    const claim = webSessions.claimTicket(now(), ticket)
    if (!claim) {
      sendText(res, 400, 'Invalid or expired ticket.')
      return true
    }

    res.statusCode = 302
    res.setHeader(
      'set-cookie',
      buildWebSessionCookieHeader({
        cookieName: webSessions.cookieName(),
        cookieValue: claim.cookieValue,
        maxAgeSeconds: WEB_SESSION_MAX_AGE_SECONDS,
      }),
    )
    res.setHeader('cache-control', 'no-store')
    res.setHeader('location', claim.redirectPath)
    res.end()
    return true
  }

  if (url.pathname === '/auth/logout') {
    res.statusCode = 302
    res.setHeader(
      'set-cookie',
      buildWebSessionClearCookieHeader({ cookieName: webSessions.cookieName() }),
    )
    res.setHeader('cache-control', 'no-store')
    res.setHeader('location', '/')
    res.end()
    return true
  }

  return false
}
