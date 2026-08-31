import type { ControlSurfaceServerDisposable } from './controlSurfaceHttpServer.contract'
import type { ControlSurface } from './controlSurface'

export type ControlSurfaceHttpListenerRole = 'combined' | 'private' | 'web'

export interface ControlSurfaceHttpListenerOptions {
  hostname: string
  bindHostname: string
  port: number
  role: ControlSurfaceHttpListenerRole
  enableWebShell: boolean
  webUiPasswordHash: string | null
  startGated?: boolean
  webAccessGeneration?: number | null
}

export interface ControlSurfaceHttpListenerAddress {
  hostname: string
  bindHostname: string
  port: number
}

export interface ControlSurfaceHttpListener extends ControlSurfaceServerDisposable {
  ready: Promise<ControlSurfaceHttpListenerAddress>
  activate: () => void
  stopAccepting: () => Promise<void>
  isAccepting: () => boolean
}

export interface ControlSurfaceWebAccessPolicy {
  enabled: boolean
  passwordRequired: boolean
}

export interface ControlSurfacePtyClientCloseFilter {
  listenerRole?: ControlSurfaceHttpListenerRole
  webAccessGeneration?: number
  webSessionGeneration?: number
  nonLoopbackOnly?: boolean
}

export interface ControlSurfaceHttpRuntime extends ControlSurfaceServerDisposable {
  readonly token: string
  readonly appVersion: string | null
  readonly ready: Promise<void>
  registerHandlers: (register: (controlSurface: ControlSurface) => void) => void
  listen: (options: ControlSurfaceHttpListenerOptions) => ControlSurfaceHttpListener
  setWebAccessPolicy: (policy: ControlSurfaceWebAccessPolicy) => void
  getWebAccessPolicy: () => ControlSurfaceWebAccessPolicy
  rotateWebSessionGeneration: () => { previousGeneration: number; generation: number }
  closePtyStreamClients: (filter: ControlSurfacePtyClientCloseFilter) => number
  getPtyStreamInstanceId: () => string
}
