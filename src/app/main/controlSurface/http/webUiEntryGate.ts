import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolveRequestAuth } from './requestAuth'
import type { WebSessionManager } from './webSessionManager'

function redirectToLogin(res: ServerResponse, redirectPath: string): void {
  res.statusCode = 302
  res.setHeader('cache-control', 'no-store')
  res.setHeader('location', `/auth/login?redirectPath=${encodeURIComponent(redirectPath)}`)
  res.end()
}

export function gateWebUiEntrypoint(options: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  token: string
  webSessions: WebSessionManager
  enableWebShell: boolean
  webUiPasswordHash: string | null
  now: Date
}): boolean {
  if (!options.webUiPasswordHash) {
    return false
  }

  if (!options.enableWebShell) {
    return false
  }

  const pathname = options.url.pathname
  if (pathname !== '/' && pathname !== '/web.html' && pathname !== '/debug/shell') {
    return false
  }

  const auth = resolveRequestAuth({
    req: options.req,
    url: options.url,
    token: options.token,
    webSessions: options.webSessions,
    allowQueryToken: false,
    now: options.now,
  })

  if (auth) {
    return false
  }

  const redirectTarget = pathname === '/web.html' ? '/web.html' : pathname
  redirectToLogin(options.res, redirectTarget)
  return true
}
