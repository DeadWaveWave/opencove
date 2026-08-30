import WebSocket from 'ws'
import { createAppError } from '../../../../shared/errors/appError'
import type { WorkerTopologyStore } from '../topology/topologyStore'
import type { ControlSurfaceRemoteEndpoint } from '../remote/controlSurfaceHttpClient'
import { PTY_STREAM_WS_PATH } from './ptyStreamService'

export function normalizeOptionalFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }
  return Math.floor(value)
}

export function resolveRemotePtyWsUrl(endpoint: { hostname: string; port: number }): string {
  return `ws://${endpoint.hostname}:${endpoint.port}${PTY_STREAM_WS_PATH}`
}

export async function resolveRemotePtyEndpointConnection(
  topology: WorkerTopologyStore,
  endpointId: string,
): Promise<ControlSurfaceRemoteEndpoint> {
  const endpoint = await topology.resolveRemoteEndpointConnection(endpointId)
  if (!endpoint) {
    throw createAppError('worker.unavailable', {
      debugMessage: `Remote endpoint unavailable: ${endpointId}`,
    })
  }
  return endpoint
}

export function trySendRemotePtyWs(ws: WebSocket, payload: unknown): boolean {
  if (ws.readyState !== WebSocket.OPEN) {
    return false
  }
  try {
    ws.send(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}
