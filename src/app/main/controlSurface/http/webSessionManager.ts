import { randomBytes } from 'node:crypto'

const WEB_SESSION_COOKIE_NAME = 'opencove_session'
const WEB_SESSION_TICKET_TTL_MS = 60_000
const WEB_SESSION_TTL_MS = 8 * 60 * 60 * 1000

export const WEB_SESSION_TICKET_MAX_AGE_SECONDS = Math.round(WEB_SESSION_TICKET_TTL_MS / 1000)
export const WEB_SESSION_MAX_AGE_SECONDS = Math.round(WEB_SESSION_TTL_MS / 1000)

function nowMs(now: Date): number {
  return now.getTime()
}

function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

function normalizeRedirectPath(value: string | null): string {
  if (!value) {
    return '/'
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) {
    return '/'
  }

  // Avoid open redirects (no schema, no host).
  if (trimmed.startsWith('//')) {
    return '/'
  }

  return trimmed
}

type TicketRecord = {
  redirectPath: string
  expiresAtMs: number
}

type SessionRecord = {
  expiresAtMs: number
}

export interface IssuedWebSessionTicket {
  ticket: string
  expiresAt: string
}

export class WebSessionManager {
  private readonly tickets = new Map<string, TicketRecord>()
  private readonly sessions = new Map<string, SessionRecord>()

  public cookieName(): string {
    return WEB_SESSION_COOKIE_NAME
  }

  public issueTicket(now: Date, redirectPath: string | null): IssuedWebSessionTicket {
    const expiresAtMs = nowMs(now) + WEB_SESSION_TICKET_TTL_MS
    const ticket = randomBytes(24).toString('base64url')
    this.tickets.set(ticket, {
      expiresAtMs,
      redirectPath: normalizeRedirectPath(redirectPath),
    })

    return {
      ticket,
      expiresAt: toIso(expiresAtMs),
    }
  }

  public claimTicket(
    now: Date,
    ticket: string,
  ): { cookieValue: string; expiresAt: string; redirectPath: string } | null {
    const record = this.tickets.get(ticket)
    if (!record) {
      return null
    }

    this.tickets.delete(ticket)

    if (record.expiresAtMs <= nowMs(now)) {
      return null
    }

    const session = this.issueSession(now)
    return { ...session, redirectPath: record.redirectPath }
  }

  public issueSession(now: Date): { cookieValue: string; expiresAt: string } {
    const expiresAtMs = nowMs(now) + WEB_SESSION_TTL_MS
    const cookieValue = randomBytes(32).toString('base64url')
    this.sessions.set(cookieValue, { expiresAtMs })

    return {
      cookieValue,
      expiresAt: toIso(expiresAtMs),
    }
  }

  public validateCookie(now: Date, cookieValue: string): boolean {
    const record = this.sessions.get(cookieValue)
    if (!record) {
      return false
    }

    if (record.expiresAtMs <= nowMs(now)) {
      this.sessions.delete(cookieValue)
      return false
    }

    return true
  }

  public expireCookie(cookieValue: string): void {
    this.sessions.delete(cookieValue)
  }

  public cleanup(now: Date): void {
    const timestamp = nowMs(now)

    for (const [ticket, record] of this.tickets) {
      if (record.expiresAtMs <= timestamp) {
        this.tickets.delete(ticket)
      }
    }

    for (const [cookieValue, record] of this.sessions) {
      if (record.expiresAtMs <= timestamp) {
        this.sessions.delete(cookieValue)
      }
    }
  }
}

export function buildWebSessionCookieHeader(options: {
  cookieName: string
  cookieValue: string
  maxAgeSeconds: number
}): string {
  const base = `${options.cookieName}=${options.cookieValue}`
  return `${base}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${options.maxAgeSeconds}`
}

export function buildWebSessionClearCookieHeader(options: { cookieName: string }): string {
  return `${options.cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
}
