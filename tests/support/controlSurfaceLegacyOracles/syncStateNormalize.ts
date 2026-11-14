// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/syncHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186. Function bodies unchanged.
import type { CreateNoteInput, WriteSyncStateInput } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeOptionalFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return value
}

export function normalizeWriteSyncStatePayload(payload: unknown): WriteSyncStateInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for sync.writeState.',
    })
  }

  return {
    state: payload.state,
    baseRevision: normalizeOptionalFiniteNumber(payload.baseRevision),
    allowEmptyWorkspaceOverwrite:
      typeof payload.allowEmptyWorkspaceOverwrite === 'boolean'
        ? payload.allowEmptyWorkspaceOverwrite
        : null,
  }
}

export function normalizeCreateNotePayload(payload: unknown): CreateNoteInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for note.create.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for note.create spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for note.create spaceId.',
    })
  }

  return {
    spaceId,
    text: normalizeOptionalString(payload.text),
    title: normalizeOptionalString(payload.title),
    x: normalizeOptionalFiniteNumber(payload.x),
    y: normalizeOptionalFiniteNumber(payload.y),
    width: normalizeOptionalFiniteNumber(payload.width),
    height: normalizeOptionalFiniteNumber(payload.height),
  }
}
