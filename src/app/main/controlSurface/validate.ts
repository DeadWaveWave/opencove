import { createAppError } from '../../../shared/errors/appError'
import type {
  ControlSurfaceInvokeRequest,
  ControlSurfaceOperationKind,
} from '../../../shared/contracts/controlSurface'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function normalizeKind(value: unknown): ControlSurfaceOperationKind {
  if (value === 'query' || value === 'command') {
    return value
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid control surface invoke request kind.',
  })
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid control surface invoke request id.',
    })
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Control surface invoke request id cannot be empty.',
    })
  }

  return normalized
}

export function normalizeInvokeRequest(value: unknown): ControlSurfaceInvokeRequest {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid control surface invoke request payload.',
    })
  }

  return {
    kind: normalizeKind(value.kind),
    id: normalizeId(value.id),
    payload: value.payload,
  }
}
