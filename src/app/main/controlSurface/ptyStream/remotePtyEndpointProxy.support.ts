import WebSocket from 'ws'
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
