import { createAppError } from '../../../shared/errors/appError'
import type { ControlSurfaceContext } from './types'

export function createControlSurfaceHttpServerContext(options: {
  signal?: AbortSignal
  enableWebShell: boolean
  ptyProtocolVersion: number
  replayWindowMaxBytes: number
}): ControlSurfaceContext {
  return {
    now: () => new Date(),
    signal: options.signal,
    assertActive: () => {
      if (options.signal?.aborted) {
        throw createAppError('worker.unavailable')
      }
    },
    capabilities: {
      webShell: options.enableWebShell,
      sync: { state: true, events: true },
      sessionStreaming: {
        enabled: true,
        ptyProtocolVersion: options.ptyProtocolVersion,
        replayWindowMaxBytes: options.replayWindowMaxBytes,
        roles: { viewer: true, controller: true },
        webAuth: { ticketToCookie: true, cookieSession: true },
      },
    },
  }
}
