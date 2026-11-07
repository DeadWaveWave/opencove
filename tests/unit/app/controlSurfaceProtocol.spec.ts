// @vitest-environment node
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { expect, it, vi } from 'vitest'
import { createControlSurfaceHttpRequestHandler } from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import type { ControlSurfaceHttpRequestHandlerDeps } from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/shared/contracts/controlSurface'

it.each([
  [undefined, true],
  [String(CONTROL_SURFACE_PROTOCOL_VERSION), true],
  ['incompatible', false],
  ['', false],
  [['2', '2'], false],
] as const)('checks protocol %j before dispatch', async (header, compatible) => {
  const envelope = { __opencoveControlEnvelope: true, ok: true, value: 'unchanged' }
  const invoke = vi.fn(async () => envelope)
  const getPersistenceStore = vi.fn()
  const handler = createControlSurfaceHttpRequestHandler({
    controlSurface: { invoke },
    token: 'test-token',
    ctx: { now: () => new Date() },
    isRuntimeClosed: () => false,
    getPersistenceStore,
  } as unknown as ControlSurfaceHttpRequestHandlerDeps)
  const req = Object.assign(
    Readable.from([JSON.stringify({ kind: 'query', id: 'system.ping', payload: null })]),
    {
      method: 'POST',
      url: '/invoke',
      headers: {
        authorization: 'Bearer test-token',
        ...(header === undefined ? {} : { 'x-opencove-protocol': header }),
      },
    },
  ) as IncomingMessage
  const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 }
  try {
    await handler({
      req,
      res: res as unknown as ServerResponse,
      listenerSyncClients: new Set(),
      listener: {
        role: 'private',
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        enableWebShell: false,
        webUiPasswordHash: null,
        webUiAuthRevision: 0,
        isWebUiAuthRevisionCurrent: () => true,
      },
    })
    expect(res.statusCode).toBe(200)
    const result = JSON.parse(res.end.mock.calls[0][0])
    if (compatible) {
      expect(result).toEqual(envelope)
      expect(invoke).toHaveBeenCalledTimes(1)
    } else {
      expect(result).toMatchObject({
        __opencoveControlEnvelope: true,
        ok: false,
        error: {
          code: 'common.protocol_incompatible',
          params: {
            client: Array.isArray(header) ? header.join(', ') : header,
            server: CONTROL_SURFACE_PROTOCOL_VERSION,
          },
        },
      })
      expect(invoke).not.toHaveBeenCalled()
    }
    expect(getPersistenceStore).not.toHaveBeenCalled()
  } finally {
    req.destroy()
  }
})
