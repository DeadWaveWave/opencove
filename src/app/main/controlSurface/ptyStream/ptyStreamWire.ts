import type { WebSocket } from 'ws'
import type { PtyStreamControllerDto, PtyStreamRole } from './ptyStreamTypes'

const WS_BACKPRESSURE_CLOSE_THRESHOLD_BYTES = 8_000_000

function isOpen(ws: WebSocket): boolean {
  return ws.readyState === ws.OPEN
}

export function sendJson(ws: WebSocket, payload: unknown): void {
  if (!isOpen(ws)) {
    return
  }

  if (ws.bufferedAmount > WS_BACKPRESSURE_CLOSE_THRESHOLD_BYTES) {
    try {
      ws.close(1013, 'backpressure')
    } catch {
      // ignore
    }
    return
  }

  try {
    ws.send(JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function toControllerDto(
  client: { clientId: string; kind: PtyStreamControllerDto['kind'] } | null,
): PtyStreamControllerDto | null {
  if (!client) {
    return null
  }

  return {
    clientId: client.clientId,
    kind: client.kind,
  }
}

export function sendPtyError(
  ws: WebSocket,
  sessionId: string | null,
  code: string,
  message: string,
): void {
  sendJson(ws, {
    type: 'error',
    code,
    message,
    ...(sessionId ? { sessionId } : {}),
  })
}

export function sendPtyData(ws: WebSocket, sessionId: string, seq: number, data: string): void {
  sendJson(ws, { type: 'data', sessionId, seq, data })
}

export function sendPtyExit(ws: WebSocket, sessionId: string, seq: number, exitCode: number): void {
  sendJson(ws, { type: 'exit', sessionId, seq, exitCode })
}

export function sendPtyOverflow(
  ws: WebSocket,
  sessionId: string,
  seq: number,
  earliestSeq: number,
): void {
  sendJson(ws, {
    type: 'overflow',
    sessionId,
    seq,
    earliestSeq,
    reason: 'replay_window_exceeded',
    recovery: 'snapshot',
  })
}

export function sendPtyAttached(
  ws: WebSocket,
  sessionId: string,
  role: PtyStreamRole,
  seq: number,
  earliestSeq: number,
  controller: PtyStreamControllerDto | null,
): void {
  sendJson(ws, {
    type: 'attached',
    sessionId,
    role,
    seq,
    earliestSeq,
    controller,
  })
}

export function sendPtyControlChanged(
  ws: WebSocket,
  sessionId: string,
  controller: PtyStreamControllerDto | null,
  role: PtyStreamRole,
): void {
  sendJson(ws, {
    type: 'control_changed',
    sessionId,
    controller,
    role,
  })
}
