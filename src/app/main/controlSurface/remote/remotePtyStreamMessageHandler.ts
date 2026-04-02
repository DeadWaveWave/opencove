import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type { TerminalDataEvent, TerminalExitEvent } from '../../../../shared/contracts/dto'

export type AttachedSessionState = {
  lastSeq: number
}

type PtyStreamMessage =
  | { type: 'hello_ack'; protocolVersion: number }
  | { type: 'attached'; sessionId: string; seq?: number }
  | { type: 'data'; sessionId: string; seq?: number; data?: string }
  | { type: 'exit'; sessionId: string; seq?: number; exitCode?: number }
  | { type: 'overflow'; sessionId: string; seq?: number }
  | { type: 'control_changed'; sessionId: string }
  | { type: 'error'; code?: string; message?: string; sessionId?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptionalFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.floor(value)
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalRawString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function createRemotePtyStreamMessageHandler(options: {
  attachedSessions: Map<string, AttachedSessionState>
  sendToSessionSubscribers: (sessionId: string, channel: string, payload: unknown) => void
  externalDataListeners: Set<(event: { sessionId: string; data: string }) => void>
  externalExitListeners: Set<(event: { sessionId: string; exitCode: number }) => void>
  snapshot: (sessionId: string) => Promise<string>
  handshake: {
    onHelloAck: () => void
    onHandshakeError: (error: Error) => void
  }
}): (raw: string) => void {
  return (raw: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return
    }

    if (!isRecord(parsed) || typeof parsed.type !== 'string') {
      return
    }

    const message = parsed as PtyStreamMessage

    if (message.type === 'hello_ack') {
      options.handshake.onHelloAck()
      return
    }

    if (message.type === 'error') {
      options.handshake.onHandshakeError(
        new Error(
          normalizeOptionalString(message.message) ??
            normalizeOptionalString(message.code) ??
            'PTY error',
        ),
      )
      return
    }

    const sessionId = normalizeOptionalString(message.sessionId)
    if (!sessionId) {
      return
    }

    if (message.type === 'attached') {
      const seq = normalizeOptionalFiniteInt(message.seq) ?? 0
      const existing = options.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      } else {
        options.attachedSessions.set(sessionId, { lastSeq: seq })
      }
      return
    }

    if (message.type === 'data') {
      const data = normalizeOptionalRawString(message.data) ?? ''
      const seq = normalizeOptionalFiniteInt(message.seq) ?? 0
      const existing = options.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }

      if (data.length > 0) {
        options.sendToSessionSubscribers(sessionId, IPC_CHANNELS.ptyData, {
          sessionId,
          data,
        } satisfies TerminalDataEvent)
        options.externalDataListeners.forEach(listener => listener({ sessionId, data }))
      }
      return
    }

    if (message.type === 'exit') {
      const exitCode = normalizeOptionalFiniteInt(message.exitCode) ?? 0
      const seq = normalizeOptionalFiniteInt(message.seq) ?? 0
      const existing = options.attachedSessions.get(sessionId)
      if (existing) {
        existing.lastSeq = Math.max(existing.lastSeq, seq)
      }

      options.sendToSessionSubscribers(sessionId, IPC_CHANNELS.ptyExit, {
        sessionId,
        exitCode,
      } satisfies TerminalExitEvent)
      options.externalExitListeners.forEach(listener => listener({ sessionId, exitCode }))
      return
    }

    if (message.type === 'overflow') {
      void (async () => {
        try {
          const snapshot = await options.snapshot(sessionId)
          if (snapshot.length > 0) {
            options.sendToSessionSubscribers(sessionId, IPC_CHANNELS.ptyData, {
              sessionId,
              data: snapshot,
            } satisfies TerminalDataEvent)
            options.externalDataListeners.forEach(listener =>
              listener({ sessionId, data: snapshot }),
            )
          }
        } catch {
          // ignore snapshot recovery failures
        }
      })()
    }
  }
}
