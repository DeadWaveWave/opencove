import { createAppError } from '../../../errors/appError'
import type { SpawnTerminalInMountInput } from '../../dto'
import { normalizeEnvPayload } from '../../normalizeTerminalEnv'
function normalizeSpawnInMountPayload(payload: unknown): SpawnTerminalInMountInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for pty.spawnInMount.',
    })
  }

  return {
    mountId: normalizeRequiredString(payload.mountId, 'pty.spawnInMount mountId'),
    cwdUri:
      payload.cwdUri === undefined || payload.cwdUri === null
        ? null
        : normalizeFileSystemUri(payload.cwdUri, 'pty.spawnInMount cwdUri'),
    profileId: normalizeOptionalString(payload.profileId),
    shell: normalizeOptionalString(payload.shell),
    command: normalizeOptionalString(payload.command),
    args: normalizeOptionalArgs(payload.args),
    cols: normalizeOptionalPositiveInt(payload.cols),
    rows: normalizeOptionalPositiveInt(payload.rows),
    env: normalizeEnvPayload(payload.env) ?? null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', { debugMessage: `Missing ${debugName}.` })
  }

  return normalized
}

function normalizeOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFileSystemUri(uri: unknown, operationId: string): string {
  if (typeof uri !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  const normalized = uri.trim()
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${operationId} uri.`,
    })
  }

  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} uri.`,
    })
  }

  if (parsed.protocol !== 'file:') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Unsupported uri scheme for ${operationId}: ${parsed.protocol}`,
    })
  }

  return normalized
}

function normalizeOptionalArgs(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null
  }

  if (!Array.isArray(value)) {
    return null
  }

  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}
export const normalizePtySpawnInMount = normalizeSpawnInMountPayload
