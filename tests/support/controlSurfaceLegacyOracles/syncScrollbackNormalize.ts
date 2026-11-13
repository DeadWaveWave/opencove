// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/syncHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Function bodies unchanged.
import type {
  ReadAgentNodePlaceholderScrollbackInput,
  ReadNodeScrollbackInput,
  WriteAgentNodePlaceholderScrollbackInput,
  WriteNodeScrollbackInput,
  WriteWorkspaceStateRawInput,
} from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
export function normalizeSyncStatePayload(payload: unknown): null {
  if (payload === null || payload === undefined) {
    return null
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid payload for sync.state.',
  })
}

export function normalizeReadWorkspaceStateRawPayload(payload: unknown): null {
  if (payload === null || payload === undefined) {
    return null
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid payload for sync.readWorkspaceStateRaw.',
  })
}

export function normalizeWriteWorkspaceStateRawPayload(
  payload: unknown,
): WriteWorkspaceStateRawInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeWorkspaceStateRaw.',
    })
  }

  const raw = payload.raw
  if (typeof raw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeWorkspaceStateRaw raw.',
    })
  }

  return { raw }
}

export function normalizeReadNodeScrollbackPayload(payload: unknown): ReadNodeScrollbackInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.readNodeScrollback.',
    })
  }

  const nodeIdRaw = payload.nodeId
  if (typeof nodeIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.readNodeScrollback nodeId.',
    })
  }

  const nodeId = nodeIdRaw.trim()
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for sync.readNodeScrollback nodeId.',
    })
  }

  return { nodeId }
}

export function normalizeWriteNodeScrollbackPayload(payload: unknown): WriteNodeScrollbackInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeNodeScrollback.',
    })
  }

  const nodeIdRaw = payload.nodeId
  if (typeof nodeIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeNodeScrollback nodeId.',
    })
  }

  const nodeId = nodeIdRaw.trim()
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for sync.writeNodeScrollback nodeId.',
    })
  }

  const scrollback = payload.scrollback
  if (scrollback !== null && scrollback !== undefined && typeof scrollback !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeNodeScrollback scrollback.',
    })
  }

  return { nodeId, scrollback: scrollback ?? null }
}

export function normalizeReadAgentNodePlaceholderScrollbackPayload(
  payload: unknown,
): ReadAgentNodePlaceholderScrollbackInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.readAgentNodePlaceholderScrollback.',
    })
  }

  const nodeIdRaw = payload.nodeId
  if (typeof nodeIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.readAgentNodePlaceholderScrollback nodeId.',
    })
  }

  const nodeId = nodeIdRaw.trim()
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for sync.readAgentNodePlaceholderScrollback nodeId.',
    })
  }

  return { nodeId }
}

export function normalizeWriteAgentNodePlaceholderScrollbackPayload(
  payload: unknown,
): WriteAgentNodePlaceholderScrollbackInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeAgentNodePlaceholderScrollback.',
    })
  }

  const nodeIdRaw = payload.nodeId
  if (typeof nodeIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeAgentNodePlaceholderScrollback nodeId.',
    })
  }

  const nodeId = nodeIdRaw.trim()
  if (nodeId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for sync.writeAgentNodePlaceholderScrollback nodeId.',
    })
  }

  const scrollback = payload.scrollback
  if (scrollback !== null && scrollback !== undefined && typeof scrollback !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeAgentNodePlaceholderScrollback scrollback.',
    })
  }

  return { nodeId, scrollback: scrollback ?? null }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
