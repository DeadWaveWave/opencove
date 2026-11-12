import { resolveRequestAuth } from '../../../src/app/main/controlSurface/http/requestAuth'
import type { IncomingMessage } from 'node:http'
// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { invokeCallerLifetime } from '../../../src/app/main/controlSurface/http/invokeCallerLifetime'
import { promptDeliveryRuntimeFixture } from '../../support/promptDeliveryRuntimeFixture'
afterEach(() => {
  vi.useRealTimers()
})
it.each(['queued', 'delay', 'expiry', 'expireCookie'] as const)(
  'real WebSessionManager revokes %s cookie delivery',
  async phase => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const ctx = createControlSurfaceHttpServerContext({
      enableWebShell: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 64000,
    })
    const web = new WebSessionManager(),
      session = web.issueSession(
        new Date(phase === 'expiry' ? 1000 - 8 * 60 * 60 * 1000 + 150 : 1000),
      )
    const auth = resolveRequestAuth({
      req: {
        headers: {
          cookie: `${web.cookieName()}=${session.cookieValue}`,
          origin: 'http://localhost',
          host: 'localhost',
        },
      } as IncomingMessage,
      url: new URL('http://localhost/invoke'),
      token: 'unused',
      webSessions: web,
      now: ctx.now(),
      allowQueryToken: false,
    })!
    const caller = invokeCallerLifetime(
      ctx,
      new EventEmitter() as ServerResponse,
      auth,
      undefined,
      web,
    )
    const f = promptDeliveryRuntimeFixture()
    let release!: () => void
    const queued =
      phase === 'queued'
        ? f.hub.withSessionInputOperation('s', async () => {
            await new Promise<void>(wake => {
              release = wake
            })
          })
        : Promise.resolve()
    if (phase === 'queued') {
      await Promise.resolve()
    }
    const result = f.deliver(caller)
    const assertion = expect(result).rejects.toHaveProperty(
      'code',
      phase === 'queued' ? 'agent.not_running' : 'agent.prompt_interrupted',
    )
    try {
      if (phase !== 'queued') {
        await Promise.resolve()
      }
      if (phase === 'expiry') {
        await vi.advanceTimersByTimeAsync(150)
      } else if (phase === 'expireCookie') {
        web.expireCookie(session.cookieValue)
      } else {
        web.invalidateAll()
      } // The password-rotation authority.
      expect(caller.signal.aborted).toBe(true)
      expect(caller.assertActive).toThrow()
      if (phase === 'queued') {
        release()
        await queued
      }
      await vi.advanceTimersByTimeAsync(300)
      await assertion
      expect(f.write).toHaveBeenCalledTimes(phase === 'queued' ? 0 : 1)
    } finally {
      caller.dispose()
      f.dispose()
    }
  },
)
