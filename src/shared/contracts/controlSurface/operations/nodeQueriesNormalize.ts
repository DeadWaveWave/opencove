import { createAppError } from '../../../errors/appError'
import type {
  CanvasFocusInput,
  CreateNodeInput,
  DeleteNodeInput,
  GetNodeInput,
  ListNodesInput,
  ManagedCanvasNodeKind,
  ReadableCanvasNodeKind,
  UpdateNodeInput,
  UpdatableCanvasNodeKind,
} from '../../dto'
import { normalizeSpaceLocator } from './spaceLocator'
function isManagedNodeKind(value: unknown): value is ManagedCanvasNodeKind {
  return (
    value === 'note' ||
    value === 'task' ||
    value === 'website' ||
    value === 'agent' ||
    value === 'terminal'
  )
}

function isReadableNodeKind(value: unknown): value is ReadableCanvasNodeKind {
  return (
    isManagedNodeKind(value) ||
    ['plugin', 'document', 'folder', 'image', 'role'].includes(String(value))
  )
}

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

function requiredString(value: unknown, debugName: string): string {
  const normalized = optionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }
  return normalized
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

function updatableKind(value: unknown): UpdatableCanvasNodeKind {
  if (isManagedNodeKind(value)) {
    return value
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid node update kind.' })
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

export function normalizeListPayload(payload: unknown): ListNodesInput {
  if (payload === null || payload === undefined) {
    return {}
  }
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid payload for node.list.' })
  }
  return {
    space:
      payload.space === null || payload.space === undefined
        ? null
        : normalizeSpaceLocator(payload.space),
    projectId: optionalString(payload.projectId),
    kind:
      payload.kind === null || payload.kind === undefined
        ? null
        : isReadableNodeKind(payload.kind)
          ? payload.kind
          : managedKind(payload.kind),
  }
}

export function normalizeGetPayload(payload: unknown): GetNodeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid payload for node.get.' })
  }
  return { nodeId: requiredString(payload.nodeId, 'nodeId') }
}

export function normalizeUpdatePayload(payload: unknown): UpdateNodeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for node.update.',
    })
  }
  return {
    kind: updatableKind(payload.kind),
    nodeId: requiredString(payload.nodeId, 'nodeId'),
    title: optionalString(payload.title),
    frame: normalizeFrame(payload.frame),
    data: payload.data ?? null,
  }
}

export function normalizeDeletePayload(payload: unknown): DeleteNodeInput {
  return { nodeId: requiredString(isRecord(payload) ? payload.nodeId : null, 'nodeId') }
}

export function normalizeFocusPayload(payload: unknown): CanvasFocusInput {
  if (!isRecord(payload) || !isRecord(payload.target)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for canvas.focus.',
    })
  }
  if (payload.target.kind === 'node') {
    return {
      target: { kind: 'node', nodeId: requiredString(payload.target.nodeId, 'nodeId') },
    }
  }
  if (payload.target.kind === 'space') {
    return { target: { kind: 'space', locator: normalizeSpaceLocator(payload.target.locator) } }
  }
  throw createAppError('common.invalid_input', { debugMessage: 'Invalid focus target.' })
}
