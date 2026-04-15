import { fromFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { AgentProviderId } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

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

export function normalizeAgentProviderId(
  value: unknown,
  operationId: string,
): AgentProviderId | null {
  const provider = normalizeOptionalString(value)
  if (!provider) {
    return null
  }

  if (
    provider === 'claude-code' ||
    provider === 'codex' ||
    provider === 'opencode' ||
    provider === 'gemini'
  ) {
    return provider
  }

  throw createAppError('common.invalid_input', {
    debugMessage: `Invalid payload for ${operationId}: ${provider}`,
  })
}

export function normalizeFileSystemUri(uri: unknown, operationId: string): string {
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

export function resolvePathFromFileSystemUriOrThrow(uri: string, operationId: string): string {
  const resolved = fromFileUri(uri)
  if (!resolved) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId}.`,
    })
  }

  return resolved
}
