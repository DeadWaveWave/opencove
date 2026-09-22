import { hostname } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import { registerSystemHandlers } from '../../src/app/main/controlSurface/handlers/systemHandlers'
import type { ControlSurfaceContext } from '../../src/app/main/controlSurface/types'

describe('terminal source runtime environment', () => {
  it('reports the emitting runtime hostname with home and platform', async () => {
    const controlSurface = createControlSurface()
    registerSystemHandlers(controlSurface, { appVersion: null })
    const context: ControlSurfaceContext = {
      now: () => new Date('2026-09-21T00:00:00Z'),
      capabilities: {
        webShell: false,
        sync: { state: true, events: true },
        sessionStreaming: {
          enabled: true,
          ptyProtocolVersion: 1,
          replayWindowMaxBytes: 1000,
          roles: { viewer: true, controller: true },
          webAuth: { ticketToCookie: true, cookieSession: true },
        },
      },
    }
    const result = await controlSurface.invoke(context, {
      kind: 'query',
      id: 'system.homeDirectory',
      payload: null,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { hostname: hostname(), platform: process.platform },
    })
  })
})
