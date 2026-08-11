export const CONTROL_SURFACE_CONNECTION_VERSION = 1 as const

export interface ControlSurfaceConnectionInfo {
  version: typeof CONTROL_SURFACE_CONNECTION_VERSION
  pid: number
  hostname: string
  port: number
  token: string
  createdAt: string
  appVersion: string | null
  startedBy?: 'cli' | 'desktop'
}

export interface ControlSurfaceServerDisposable {
  dispose: () => Promise<void>
}

export interface ControlSurfaceHttpServerInstance extends ControlSurfaceServerDisposable {
  ready: Promise<ControlSurfaceConnectionInfo>
}

export function normalizeControlSurfaceAppVersion(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
