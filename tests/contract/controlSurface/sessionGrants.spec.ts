// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { inspect } from 'node:util'
import type { IncomingMessage } from 'node:http'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { SESSION_GRANT_POLICY } from '../../../src/app/main/controlSurface/http/sessionGrantPolicy'
import { sessionGrantAllowsOperation } from '../../../src/app/main/controlSurface/http/sessionGrantAuthorization'
import { resolveRequestAuth } from '../../../src/app/main/controlSurface/http/requestAuth'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { CONTROL_SURFACE_OPERATIONS } from '../../../src/shared/contracts/controlSurface/operations'

const identity = { projectId: 'project', spaceId: 'space', nodeId: 'node', sessionId: 'session' }
const ctx = createControlSurfaceHttpServerContext({
  enableWebShell: false,
  ptyProtocolVersion: 1,
  replayWindowMaxBytes: 10,
})

describe('session grants', () => {
  it('issues 256 bits, keeps credentials private, and revokes on exit and restart', () => {
    let alive = true
    const registry = new SessionGrantRegistry(() => alive)
    const { token, grant } = registry.issue(identity)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(registry.verify(token)).toEqual(grant)
    expect(registry.verify(token + 'x')).toBeNull()
    expect(inspect(registry, { showHidden: true })).not.toContain(token)
    expect(JSON.stringify(grant)).not.toContain(token)
    expect(grant).not.toHaveProperty('tokenHash')
    expect(new SessionGrantRegistry(() => true).verify(token)).toBeNull()
    alive = false
    expect(registry.verify(token)).toBeNull()
    alive = true
    expect(registry.verify(token)).toBeNull()
    const next = registry.issue(identity)
    registry.revokeSession(identity.sessionId)
    expect(registry.verify(next.token)).toBeNull()
    alive = false
    expect(() => registry.issue(identity)).toThrow('absent session')
  })

  it('uses the explicit policy while retaining the tier ceiling', () => {
    for (const op of CONTROL_SURFACE_OPERATIONS) {
      const denied = SESSION_GRANT_POLICY[op.id].access === 'deny'
      expect(sessionGrantAllowsOperation(op.id)).toBe(!denied && op.scope !== 'admin')
    }
    expect(sessionGrantAllowsOperation('unknown')).toBe(false)
  })

  it('authenticates grants only via bearer and never falls back from revoked bearer to cookie', () => {
    const registry = new SessionGrantRegistry(() => true)
    const { token, grant } = registry.issue(identity)
    const webSessions = new WebSessionManager()
    const ticket = webSessions.issueTicket(new Date(), '/')
    const cookie = webSessions.claimTicket(new Date(), ticket.ticket)!
    const options = {
      req: {
        headers: {
          authorization: `Bearer ${token}`,
          cookie: `${webSessions.cookieName()}=${cookie.cookieValue}`,
          host: 'localhost',
          origin: 'http://localhost',
        },
      } as IncomingMessage,
      url: new URL('http://localhost/invoke'),
      token: 'worker-secret',
      webSessions,
      sessionGrants: registry,
      allowQueryToken: true,
      now: new Date(),
    }
    expect(resolveRequestAuth(options)).toEqual({ kind: 'session-grant', grant })
    registry.revokeSession(identity.sessionId)
    expect(resolveRequestAuth(options)).toBeNull()
    expect(
      resolveRequestAuth({
        ...options,
        req: { headers: {} } as IncomingMessage,
        url: new URL(`http://localhost/events?token=${token}`),
      }),
    ).toBeNull()
  })

  it('returns explicit whoami fields for each auth kind and refuses unregistered handlers', async () => {
    const registry = new SessionGrantRegistry(() => true)
    const { token, grant } = registry.issue(identity)
    const surface = createControlSurface()
    registerSystemHandlers(surface, { instanceId: 'instance', appVersion: '1.0' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const auth of [
        { kind: 'bearer' } as const,
        { kind: 'cookie', webSessionGeneration: 0 } as const,
        { kind: 'session-grant', grant } as const,
      ]) {
        // Requests are sequential to observe authorization and revocation boundaries.
        // eslint-disable-next-line no-await-in-loop
        const result = await surface.invoke(
          { ...ctx, requestAuth: auth },
          { kind: 'query', id: 'system.whoami', payload: {} },
        )
        expect(result).toMatchObject({
          ok: true,
          value: {
            kind: auth.kind,
            scopeTier: auth.kind === 'session-grant' ? 'interact' : 'admin',
            instanceId: 'instance',
            appVersion: '1.0',
          },
        })
        expect(JSON.stringify(result)).not.toContain(token)
        expect(JSON.stringify(result)).not.toContain('tokenHash')
        if (auth.kind === 'session-grant') {
          expect(result).toMatchObject({ value: identity })
        }
      }
      surface.register('not.registered', {
        kind: 'query',
        validate: x => x,
        handle: () => 'unsafe',
        defaultErrorCode: 'common.unexpected',
      })
      for (const id of ['not.registered', 'worker.shutdown']) {
        expect(
          // Requests are sequential to observe authorization and revocation boundaries.
          // eslint-disable-next-line no-await-in-loop
          await surface.invoke(
            { ...ctx, requestAuth: { kind: 'session-grant', grant } },
            { kind: 'query', id, payload: {} },
          ),
        ).toMatchObject({ ok: false, error: { code: 'common.forbidden' } })
      }
      expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toContain(token)
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })
})
