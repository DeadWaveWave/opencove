import { isAbsolute, win32 } from 'node:path'
import {
  CANVAS_IMAGE_MIME_TYPES,
  MAX_CANVAS_IMAGE_BYTES,
  WORKSPACE_PATH_OPENER_IDS,
  type CanvasImageMimeType,
  type CopyWorkspacePathInput,
  type DeleteCanvasImageInput,
  type EnsureDirectoryInput,
  type OpenWorkspacePathInput,
  type ReadCanvasImageInput,
  type WorkspacePathOpenerId,
  type WriteCanvasImageInput,
} from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function normalizePathValue(value: unknown, channel: string): string {
  const path = typeof value === 'string' ? value.trim() : ''

  if (path.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid path for ${channel}`,
    })
  }

  if (!isAbsolute(path) && !win32.isAbsolute(path)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${channel} requires an absolute path`,
    })
  }

  return path
}

function normalizeWorkspacePathOpenerId(value: unknown): WorkspacePathOpenerId {
  if (
    typeof value === 'string' &&
    WORKSPACE_PATH_OPENER_IDS.includes(value as WorkspacePathOpenerId)
  ) {
    return value as WorkspacePathOpenerId
  }

  throw createAppError('common.invalid_input', {
    debugMessage: 'Invalid openerId for workspace:open-path',
  })
}

const CANVAS_IMAGE_ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeCanvasImageAssetId(value: unknown, channel: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length === 0 || !CANVAS_IMAGE_ASSET_ID_PATTERN.test(normalized)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid assetId for ${channel}`,
    })
  }

  return normalized
}

function normalizeCanvasImageMimeType(value: unknown, channel: string): CanvasImageMimeType {
  if (typeof value === 'string' && CANVAS_IMAGE_MIME_TYPES.includes(value as CanvasImageMimeType)) {
    return value as CanvasImageMimeType
  }

  throw createAppError('common.invalid_input', {
    debugMessage: `Invalid mimeType for ${channel}`,
  })
}

function normalizeCanvasImageBytes(value: unknown, channel: string): Uint8Array {
  const bytes =
    value instanceof Uint8Array
      ? value
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : null

  if (!bytes || bytes.byteLength === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid bytes for ${channel}`,
    })
  }

  if (bytes.byteLength > MAX_CANVAS_IMAGE_BYTES) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Canvas image too large (${bytes.byteLength} bytes > ${MAX_CANVAS_IMAGE_BYTES} bytes).`,
    })
  }

  return bytes
}

function normalizeCanvasImageFileName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }

  return normalized.slice(0, 240)
}

export function normalizeWriteCanvasImagePayload(payload: unknown): WriteCanvasImageInput {
  const channel = 'workspace:write-canvas-image'

  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${channel}`,
    })
  }

  const record = payload as Record<string, unknown>
  return {
    assetId: normalizeCanvasImageAssetId(record.assetId, channel),
    bytes: normalizeCanvasImageBytes(record.bytes, channel),
    mimeType: normalizeCanvasImageMimeType(record.mimeType, channel),
    fileName: normalizeCanvasImageFileName(record.fileName),
  }
}

export function normalizeReadCanvasImagePayload(payload: unknown): ReadCanvasImageInput {
  const channel = 'workspace:read-canvas-image'

  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${channel}`,
    })
  }

  const record = payload as Record<string, unknown>
  return {
    assetId: normalizeCanvasImageAssetId(record.assetId, channel),
  }
}

export function normalizeDeleteCanvasImagePayload(payload: unknown): DeleteCanvasImageInput {
  const channel = 'workspace:delete-canvas-image'

  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${channel}`,
    })
  }

  const record = payload as Record<string, unknown>
  return {
    assetId: normalizeCanvasImageAssetId(record.assetId, channel),
  }
}

export function normalizeEnsureDirectoryPayload(payload: unknown): EnsureDirectoryInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace:ensure-directory',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    path: normalizePathValue(record.path, 'workspace:ensure-directory'),
  }
}

export function normalizeCopyWorkspacePathPayload(payload: unknown): CopyWorkspacePathInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace:copy-path',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    path: normalizePathValue(record.path, 'workspace:copy-path'),
  }
}

export function normalizeOpenWorkspacePathPayload(payload: unknown): OpenWorkspacePathInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for workspace:open-path',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    path: normalizePathValue(record.path, 'workspace:open-path'),
    openerId: normalizeWorkspacePathOpenerId(record.openerId),
  }
}
