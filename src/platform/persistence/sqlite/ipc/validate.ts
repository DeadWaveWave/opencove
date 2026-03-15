import type {
  ReadNodeScrollbackInput,
  WriteAppStateInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
} from '../../../../shared/contracts/dto'
import { utf8ByteLength } from '../utils'
import { createAppError } from '../../../../shared/errors/appError'

const DEFAULT_MAX_RAW_BYTES = 50 * 1024 * 1024

export class PayloadTooLargeError extends Error {
  public readonly bytes: number
  public readonly maxBytes: number

  public constructor(bytes: number, maxBytes: number) {
    super(`Payload too large (${bytes} bytes > ${maxBytes} bytes).`)
    this.name = 'PayloadTooLargeError'
    this.bytes = bytes
    this.maxBytes = maxBytes
  }
}

export function normalizeWriteWorkspaceStateRawPayload(
  payload: unknown,
  options: { maxRawBytes?: number } = {},
): WriteWorkspaceStateRawInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for persistence:write-workspace-state-raw',
    })
  }

  const record = payload as Record<string, unknown>
  const raw = typeof record.raw === 'string' ? record.raw : ''

  if (raw.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid raw payload for persistence:write-workspace-state-raw',
    })
  }

  const maxRawBytes = options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES
  const rawBytes = utf8ByteLength(raw)
  if (rawBytes > maxRawBytes) {
    throw new PayloadTooLargeError(rawBytes, maxRawBytes)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid JSON payload for persistence:write-workspace-state-raw',
    })
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Workspace state payload must be a JSON object',
    })
  }

  return { raw }
}

export function normalizeWriteAppStatePayload(payload: unknown): WriteAppStateInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for persistence:write-app-state',
    })
  }

  const record = payload as Record<string, unknown>
  const state = record.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid app state payload for persistence:write-app-state',
    })
  }

  return { state }
}

export function normalizeReadNodeScrollbackPayload(payload: unknown): ReadNodeScrollbackInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for persistence:read-node-scrollback',
    })
  }

  const record = payload as Record<string, unknown>
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : ''
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid nodeId payload for persistence:read-node-scrollback',
    })
  }

  return { nodeId }
}

export function normalizeWriteNodeScrollbackPayload(payload: unknown): WriteNodeScrollbackInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for persistence:write-node-scrollback',
    })
  }

  const record = payload as Record<string, unknown>
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId.trim() : ''
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid nodeId payload for persistence:write-node-scrollback',
    })
  }

  const scrollback =
    record.scrollback === null
      ? null
      : typeof record.scrollback === 'string'
        ? record.scrollback
        : null

  return { nodeId, scrollback }
}
