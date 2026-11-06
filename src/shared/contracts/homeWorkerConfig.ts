import type { HomeWorkerMode, RemoteWorkerEndpointDto } from '@shared/contracts/dto'

export function isHomeWorkerConfigRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeHomeWorkerOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

export function normalizeHomeWorkerOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeHomeWorkerMode(value: unknown): HomeWorkerMode | null {
  return value === 'standalone' || value === 'local' || value === 'remote' ? value : null
}

export function normalizeHomeWorkerRemoteEndpoint(value: unknown): RemoteWorkerEndpointDto | null {
  if (value === null) {
    return null
  }
  if (!isHomeWorkerConfigRecord(value)) {
    return null
  }
  const hostname = normalizeHomeWorkerOptionalString(value.hostname)
  const token = normalizeHomeWorkerOptionalString(value.token)
  const port = value.port
  return hostname &&
    token &&
    typeof port === 'number' &&
    Number.isFinite(port) &&
    port > 0 &&
    port <= 65_535
    ? { hostname, port, token }
    : null
}

export type HomeWorkerWebUiConfigFile = {
  enabled: boolean
  port: number | null
  exposeOnLan: boolean
  passwordHash: string | null
}

export type HomeWorkerConfigFile = {
  version: 1
  mode: HomeWorkerMode
  remote: RemoteWorkerEndpointDto | null
  webUi: HomeWorkerWebUiConfigFile
  updatedAt: string | null
}

export interface HomeWorkerConfigModeOptions {
  allowStandaloneMode?: boolean
  allowRemoteMode?: boolean
}

export function isHomeWorkerModeSupported(
  mode: HomeWorkerMode,
  options?: HomeWorkerConfigModeOptions,
): boolean {
  if (mode === 'standalone') {
    return options?.allowStandaloneMode ?? true
  }
  if (mode === 'remote') {
    return options?.allowRemoteMode ?? true
  }
  return true
}
