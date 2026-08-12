import type { ControlSurfaceContext } from './types'

export function createControlSurfaceHttpServerContext(options: {
  enableWebShell: boolean
  ptyProtocolVersion: number
  replayWindowMaxBytes: number
}): ControlSurfaceContext {
  return {
    now: () => new Date(),
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
