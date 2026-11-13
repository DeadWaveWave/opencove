import { hasNodeFrameCoordinates, NODE_NEAR_FRAME_ERROR } from '../../../utils/nodeNearFrame'
import { createAppError } from '../../../errors/appError'
import { assertInitialPromptText } from '../../../utils/initialPromptValidation'
import type { CreateNodeInput, ManagedCanvasNodeKind } from '../../dto'
import { normalizeSpaceLocator } from './spaceLocator'
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
  if (
    payload.kind === 'agent' &&
    isRecord(payload.data) &&
    typeof payload.data.prompt === 'string'
  ) {
    assertInitialPromptText(payload.data.prompt)
  }
  let near: CreateNodeInput['near']
  if (payload.near !== undefined) {
    const value = payload.near
    if (
      !isRecord(value) ||
      typeof value.nodeId !== 'string' ||
      !value.nodeId.trim() ||
      (value.target !== 'reference-container' && value.target !== 'root-canvas') ||
      Object.keys(value).some(key => key !== 'nodeId' && key !== 'target') ||
      (value.target === 'root-canvas' && payload.space !== undefined && payload.space !== null)
    ) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Invalid near placement or conflicting frame/Space.',
      })
    }
    if (hasNodeFrameCoordinates(payload.frame)) {
      throw createAppError('common.invalid_input', { debugMessage: NODE_NEAR_FRAME_ERROR })
    }
    near = { nodeId: value.nodeId.trim(), target: value.target }
  }
  return {
    ...(near === undefined ? {} : { near }),
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
