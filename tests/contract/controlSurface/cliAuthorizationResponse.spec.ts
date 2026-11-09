// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { invoke } from '../../../src/app/cli/core/transport'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import {
  createControlSurfaceHttpRequestHandler,
  type ControlSurfaceHttpRequestHandlerDeps,
} from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { WebSessionManager } from '../../../src/app/main/controlSurface/http/webSessionManager'

it('renders the real password-protected web-ticket refusal without declaring a valid bearer revoked', async () => {
  const surface = createControlSurface()
  const dispatch = vi.spyOn(surface, 'invoke')
  const persistence = vi.fn()
  const handler = createControlSurfaceHttpRequestHandler({
    controlSurface: surface,
    token: 'valid-worker-token',
    webSessions: new WebSessionManager(),
    ctx: { now: () => new Date(), capabilities: {} },
    isRuntimeClosed: () => false,
    getWebAccessPolicy: () => ({ enabled: true, passwordRequired: true }),
    getPersistenceStore: persistence,
  } as unknown as ControlSurfaceHttpRequestHandlerDeps)
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const req = Object.assign(new EventEmitter(), {
      method: 'POST',
      url: '/invoke',
      headers: Object.fromEntries(new Headers(init?.headers)),
    }) as IncomingMessage
    let body = ''
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      setHeader: vi.fn(),
      end: (value: string) => {
        body = value
      },
    }) as unknown as ServerResponse
    const pending = handler({
      req,
      res,
      listenerSyncClients: new Set(),
      listener: {
        role: 'private',
        hostname: 'localhost',
        bindHostname: 'localhost',
        port: 0,
        enableWebShell: false,
        webUiPasswordHash: null,
        webUiAuthRevision: 0,
        isWebUiAuthRevisionCurrent: () => true,
      },
    })
    await vi.waitFor(() => expect(req.listenerCount('end')).toBe(1), { interval: 1 })
    req.emit('data', String(init?.body))
    req.emit('end')
    await pending
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(body)).toMatchObject({
      ok: false,
      error: { code: 'control_surface.unauthorized' },
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(persistence).not.toHaveBeenCalled()
    return new Response(body, { status: res.statusCode })
  }
  await expect(
    invoke(
      { endpoint: 'http://fixture', token: 'valid-worker-token' },
      { kind: 'command', id: 'auth.issueWebSessionTicket', payload: {} },
      { timeoutMs: 1000, fetch },
    ),
  ).rejects.toMatchObject({
    code: 'control_surface.unauthorized',
    exitCode: 4,
    message: 'This credential does not permit the operation.',
  })
})
