// @vitest-environment node
import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { createControlSurfaceHttpRequestHandler } from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import type { ControlSurfaceHttpRequestHandlerDeps } from '../../../src/app/main/controlSurface/controlSurfaceHttpRequestHandler'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSystemHandlers } from '../../../src/app/main/controlSurface/handlers/systemHandlers'
import { CONTROL_SURFACE_PROTOCOL_VERSION } from '../../../src/shared/contracts/controlSurface'

for (const header of [
  undefined,
  String(CONTROL_SURFACE_PROTOCOL_VERSION),
  'incompatible',
  '',
] as const) {
  it(`serves /invoke with protocol header ${JSON.stringify(header)}`, async () => {
    const controlSurface = createControlSurface()
    registerSystemHandlers(controlSurface, { appVersion: null })
    const getPersistenceStore = vi.fn()
    const invoke = vi.spyOn(controlSurface, 'invoke')
    const handler = createControlSurfaceHttpRequestHandler({
      controlSurface,
      token: 'test-token',
      ctx: { now: () => new Date(), capabilities: {} },
      isRuntimeClosed: () => false,
      getWebAccessPolicy: () => ({ enabled: false, passwordRequired: false }),
      getPersistenceStore,
    } as unknown as ControlSurfaceHttpRequestHandlerDeps)
    const server = createServer((req, res) => {
      void handler({
        req,
        res,
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
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Missing address')
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/invoke`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
          ...(header === undefined ? {} : { 'x-opencove-protocol': header }),
        },
        body: JSON.stringify({ kind: 'query', id: 'system.ping', payload: null }),
      })
      expect(response.status).toBe(200)
      const result = await response.json()
      if (header === undefined || header === String(CONTROL_SURFACE_PROTOCOL_VERSION)) {
        expect(result).toMatchObject({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { ok: true },
        })
        expect(invoke).toHaveBeenCalledTimes(1)
      } else {
        expect(result).toMatchObject({
          __opencoveControlEnvelope: true,
          ok: false,
          error: {
            code: 'common.protocol_incompatible',
            params: { client: header, server: CONTROL_SURFACE_PROTOCOL_VERSION },
          },
        })
        expect(invoke).not.toHaveBeenCalled()
      }
      expect(getPersistenceStore).not.toHaveBeenCalled()
    } finally {
      server.closeAllConnections()
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve())),
        )
      }
    }
  })
}
