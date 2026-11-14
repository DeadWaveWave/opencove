// @compat-file control-surface-legacy-validation
// Frozen from src/app/main/controlSurface/handlers/sessionLaunchPayloadSupport.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator bodies verbatim, imports adjusted.
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../../../src/shared/contracts/dto'
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

export function normalizeOptionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

export function normalizeAgentProviderId(
  value: unknown,
  operationId: string,
): AgentProviderId | null {
  const provider = normalizeOptionalString(value)
  if (!provider) {
    return null
  }

  if (AGENT_PROVIDER_IDS.includes(provider as AgentProviderId)) {
    return provider as AgentProviderId
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
