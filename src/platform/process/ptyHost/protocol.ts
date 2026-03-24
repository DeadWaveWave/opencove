export const PTY_HOST_PROTOCOL_VERSION = 1 as const

export type PtyHostWriteEncoding = 'utf8' | 'binary'

export type PtyHostSpawnRequest = {
  type: 'spawn'
  requestId: string
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols: number
  rows: number
}

export type PtyHostWriteRequest = {
  type: 'write'
  sessionId: string
  data: string
  encoding: PtyHostWriteEncoding
}

export type PtyHostResizeRequest = {
  type: 'resize'
  sessionId: string
  cols: number
  rows: number
}

export type PtyHostKillRequest = {
  type: 'kill'
  sessionId: string
}

export type PtyHostShutdownRequest = {
  type: 'shutdown'
}

export type PtyHostCrashRequest = {
  type: 'crash'
}

export type PtyHostRequest =
  | PtyHostSpawnRequest
  | PtyHostWriteRequest
  | PtyHostResizeRequest
  | PtyHostKillRequest
  | PtyHostShutdownRequest
  | PtyHostCrashRequest

export type PtyHostReadyMessage = {
  type: 'ready'
  protocolVersion: typeof PTY_HOST_PROTOCOL_VERSION
}

export type PtyHostResponseMessage =
  | {
      type: 'response'
      requestId: string
      ok: true
      result: { sessionId: string }
    }
  | {
      type: 'response'
      requestId: string
      ok: false
      error: { name?: string; message: string }
    }

export type PtyHostDataMessage = {
  type: 'data'
  sessionId: string
  data: string
}

export type PtyHostExitMessage = {
  type: 'exit'
  sessionId: string
  exitCode: number
}

export type PtyHostMessage =
  | PtyHostReadyMessage
  | PtyHostResponseMessage
  | PtyHostDataMessage
  | PtyHostExitMessage

export function isPtyHostMessage(value: unknown): value is PtyHostMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.type === 'string'
}

const PTY_HOST_REQUEST_TYPES = new Set<string>([
  'spawn',
  'write',
  'resize',
  'kill',
  'shutdown',
  'crash',
])

export function isPtyHostRequest(value: unknown): value is PtyHostRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string') {
    return false
  }

  return PTY_HOST_REQUEST_TYPES.has(record.type)
}
