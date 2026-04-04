import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifyWebUiPassword } from './webUiPassword'
import {
  buildWebSessionCookieHeader,
  buildWebSessionClearCookieHeader,
  type WebSessionManager,
  WEB_SESSION_MAX_AGE_SECONDS,
} from './webSessionManager'

const MAX_LOGIN_BODY_BYTES = 8 * 1024
const LOGIN_FAILURE_WINDOW_MS = 60_000
const MAX_LOGIN_FAILURES_PER_WINDOW = 8

type LoginFailureRecord = {
  windowStartedAtMs: number
  failures: number
}

const loginFailuresByClient = new Map<string, LoginFailureRecord>()

function nowMs(now: Date): number {
  return now.getTime()
}

function resolveClientKey(req: IncomingMessage): string {
  const raw = req.socket.remoteAddress ?? 'unknown'
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'unknown'
}

function isLoginRateLimited(clientKey: string, now: Date): boolean {
  const record = loginFailuresByClient.get(clientKey)
  if (!record) {
    return false
  }

  const timestamp = nowMs(now)
  if (timestamp - record.windowStartedAtMs >= LOGIN_FAILURE_WINDOW_MS) {
    loginFailuresByClient.delete(clientKey)
    return false
  }

  return record.failures >= MAX_LOGIN_FAILURES_PER_WINDOW
}

function recordLoginFailure(clientKey: string, now: Date): void {
  const timestamp = nowMs(now)
  const record = loginFailuresByClient.get(clientKey)

  if (!record || timestamp - record.windowStartedAtMs >= LOGIN_FAILURE_WINDOW_MS) {
    loginFailuresByClient.set(clientKey, { windowStartedAtMs: timestamp, failures: 1 })
    return
  }

  record.failures += 1
  loginFailuresByClient.set(clientKey, record)
}

function clearLoginFailures(clientKey: string): void {
  loginFailuresByClient.delete(clientKey)
}

function sendText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(`${message}\n`)
}

function normalizeRedirectPath(value: string | null): string {
  if (!value) {
    return '/'
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) {
    return '/'
  }

  if (trimmed.startsWith('//')) {
    return '/'
  }

  return trimmed
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, match => {
    switch (match) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return match
    }
  })
}

function renderLoginPage(options: { redirectPath: string; errorMessage: string | null }): string {
  const errorHtml = options.errorMessage
    ? `<div class="error">${escapeHtml(options.errorMessage)}</div>`
    : ''

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenCove Web UI</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        background: #0b0d10;
        color: #e8eef6;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: #11151b;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      }
      h1 { font-size: 16px; margin: 0 0 12px; }
      p { margin: 0 0 16px; opacity: 0.85; font-size: 13px; line-height: 1.4; }
      label { display: block; font-size: 12px; margin: 0 0 6px; opacity: 0.9; }
      input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.04);
        color: inherit;
        outline: none;
      }
      input:focus { border-color: rgba(99, 179, 255, 0.6); box-shadow: 0 0 0 2px rgba(99, 179, 255, 0.15); }
      button {
        margin-top: 12px;
        width: 100%;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(99, 179, 255, 0.18);
        color: inherit;
        cursor: pointer;
      }
      button:hover { background: rgba(99, 179, 255, 0.26); }
      .error {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(255, 80, 80, 0.12);
        border: 1px solid rgba(255, 80, 80, 0.25);
        color: #ffb4b4;
        font-size: 12px;
      }
      .hint { margin-top: 12px; font-size: 12px; opacity: 0.7; }
      a { color: #86c5ff; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>OpenCove Web UI</h1>
      <p>This Worker requires a password. If you’re on a shared network, consider using an SSH tunnel or VPN.</p>
      <form method="post" action="/auth/login">
        <input type="hidden" name="redirectPath" value="${escapeHtml(options.redirectPath)}" />
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
        <button type="submit">Sign in</button>
      </form>
      ${errorHtml}
      <div class="hint"><a href="/auth/logout">Clear session</a></div>
    </div>
  </body>
</html>`
}

async function readRequestBodyText(req: IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let totalBytes = 0

    req.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        rejectPromise(new Error('Request body is too large.'))
        try {
          req.destroy()
        } catch {
          // ignore
        }
        return
      }

      chunks.push(buffer)
    })

    req.on('end', () => {
      resolvePromise(Buffer.concat(chunks).toString('utf8'))
    })

    req.on('error', error => {
      rejectPromise(error)
    })
  })
}

export async function tryHandleWebAuthRoutes(options: {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  now: () => Date
  webSessions: WebSessionManager
  webUiPasswordHash: string | null
}): Promise<boolean> {
  const { req, res, url, now, webSessions, webUiPasswordHash } = options

  if (url.pathname === '/auth/claim') {
    if (webUiPasswordHash) {
      sendText(res, 403, 'Ticket auth is disabled when password auth is enabled.')
      return true
    }

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

  if (url.pathname === '/auth/login') {
    if (!webUiPasswordHash) {
      sendText(res, 404, 'Password auth is not enabled.')
      return true
    }

    const redirectPath = normalizeRedirectPath(url.searchParams.get('redirectPath'))

    if (req.method === 'GET') {
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(renderLoginPage({ redirectPath, errorMessage: null }))
      return true
    }

    if (req.method !== 'POST') {
      sendText(res, 405, 'Method not allowed.')
      return true
    }

    const clientKey = resolveClientKey(req)
    if (isLoginRateLimited(clientKey, now())) {
      sendText(res, 429, 'Too many failed attempts. Please try again later.')
      return true
    }

    try {
      const bodyText = await readRequestBodyText(req, MAX_LOGIN_BODY_BYTES)
      const params = new URLSearchParams(bodyText)
      const password = params.get('password') ?? ''
      const redirectPathFromBody = normalizeRedirectPath(params.get('redirectPath'))

      const ok = await verifyWebUiPassword(password, webUiPasswordHash)
      if (!ok) {
        recordLoginFailure(clientKey, now())
        res.statusCode = 401
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(
          renderLoginPage({
            redirectPath: redirectPathFromBody,
            errorMessage: 'Invalid password.',
          }),
        )
        return true
      }

      clearLoginFailures(clientKey)

      const session = webSessions.issueSession(now())
      res.statusCode = 302
      res.setHeader(
        'set-cookie',
        buildWebSessionCookieHeader({
          cookieName: webSessions.cookieName(),
          cookieValue: session.cookieValue,
          maxAgeSeconds: WEB_SESSION_MAX_AGE_SECONDS,
        }),
      )
      res.setHeader('cache-control', 'no-store')
      res.setHeader('location', redirectPathFromBody)
      res.end()
      return true
    } catch {
      sendText(res, 400, 'Invalid request.')
      return true
    }
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
