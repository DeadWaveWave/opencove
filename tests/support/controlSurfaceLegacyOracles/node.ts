// Frozen oracle: copied from src/app/main/controlSurface/handlers/nodeControlHandlers.ts at 90f8a89ba50d70147773c4e04ba15c31063d393c; do not edit; delete when the parity window closes.
import { createAppError } from '../../../src/shared/errors/appError'
import type { CreateNodeInput, ManagedCanvasNodeKind } from '../../../src/shared/contracts/dto'
import { normalizeSpaceLocator } from './locator'
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function managedKind(value: unknown): ManagedCanvasNodeKind {
  if (
    value === 'note' ||
    value === 'task' ||
    value === 'website' ||
    value === 'agent' ||
    value === 'terminal'
  ) {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid node kind.' })
}

function normalizeFrame(value: unknown): CreateNodeInput['frame'] {
  if (value === null || value === undefined) {
    return null
  }
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid node frame.' })
  }
  const result: NonNullable<CreateNodeInput['frame']> = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (value[key] === null || value[key] === undefined) {
      continue
    }
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
      throw createAppError('common.invalid_input', { debugMessage: `Invalid frame.${key}.` })
    }
    result[key] = value[key]
  }
  return result
}

export function normalizeCreatePayload(payload: unknown): CreateNodeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for node.create.',
    })
  }
  return {
    kind: managedKind(payload.kind),
    space:
      payload.space === null || payload.space === undefined
        ? null
        : normalizeSpaceLocator(payload.space),
    projectId: optionalString(payload.projectId),
    title: optionalString(payload.title),
    frame: normalizeFrame(payload.frame),
    data: payload.data ?? null,
  }
}
