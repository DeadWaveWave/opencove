// @vitest-environment node

import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { resolveRequestAuth } from '../../../src/app/main/controlSurface/http/requestAuth'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'

function createCookieHeader(webSessions: WebSessionManager): string {
  const issued = webSessions.issueTicket(new Date('2026-04-01T00:00:00.000Z'), '/')
  const claimed = webSessions.claimTicket(new Date('2026-04-01T00:00:01.000Z'), issued.ticket)
  if (!claimed) {
    throw new Error('Failed to claim test web session ticket')
  }

  return `${webSessions.cookieName()}=${claimed.cookieValue}`
}

function createRequest(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage
}

describe('resolveRequestAuth', () => {
  it('accepts bearer tokens', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        authorization: 'Bearer test-token',
        host: '127.0.0.1:8080',
      }),
      url: new URL('http://127.0.0.1:8080/invoke'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:00.000Z'),
    })

    expect(auth).toEqual({ kind: 'bearer' })
  })

  it('accepts cookie auth for same-origin requests without an Origin header', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        cookie: createCookieHeader(webSessions),
        host: '127.0.0.1:8080',
        referer: 'http://127.0.0.1:8080/',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toEqual({ kind: 'cookie' })
  })

  it('accepts cookie auth for same-origin browser fetch metadata requests', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        cookie: createCookieHeader(webSessions),
        host: '127.0.0.1:8080',
        'sec-fetch-site': 'same-origin',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toEqual({ kind: 'cookie' })
  })

  it('rejects cookie auth for cross-origin requests', () => {
    const webSessions = new WebSessionManager()
    const auth = resolveRequestAuth({
      req: createRequest({
        cookie: createCookieHeader(webSessions),
        host: '127.0.0.1:8080',
        origin: 'http://evil.example',
      }),
      url: new URL('http://127.0.0.1:8080/events'),
      token: 'test-token',
      webSessions,
      allowQueryToken: false,
      now: new Date('2026-04-01T00:00:02.000Z'),
    })

    expect(auth).toBeNull()
  })
})
