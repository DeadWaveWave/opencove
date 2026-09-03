// @vitest-environment node

import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { tryHandleWebAuthRoutes } from '../../../src/app/main/controlSurface/http/webAuthRoutes'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'

function loginRequest(body: string) {
  const request = Readable.from([body]) as Readable & {
    method: string
    socket: { remoteAddress: string }
  }
  request.method = 'POST'
  request.socket = { remoteAddress: '127.0.0.1' }
  return request
}

describe('Web auth routes', () => {
  it('does not issue a session from password verification started before policy rotation', async () => {
    let resolveVerification!: (valid: boolean) => void
    let markVerificationStarted!: () => void
    const verificationStarted = new Promise<void>(resolve => {
      markVerificationStarted = resolve
    })
    let authRevisionCurrent = true
    const headers = new Map<string, unknown>()
    const response = {
      statusCode: 0,
      setHeader: vi.fn((name: string, value: unknown) => headers.set(name.toLowerCase(), value)),
      end: vi.fn(),
    }

    const operation = tryHandleWebAuthRoutes({
      req: loginRequest('password=old-password') as never,
      res: response as never,
      url: new URL('http://localhost/auth/login'),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      webSessions: new WebSessionManager(),
      webUiPasswordHash: 'old-hash',
      isWebUiAuthRevisionCurrent: () => authRevisionCurrent,
      verifyPassword: async () => {
        markVerificationStarted()
        return await new Promise<boolean>(resolve => {
          resolveVerification = resolve
        })
      },
    })

    await verificationStarted
    authRevisionCurrent = false
    resolveVerification(true)
    await expect(operation).resolves.toBe(true)

    expect(response.statusCode).toBe(401)
    expect(headers.has('set-cookie')).toBe(false)
  })
})
