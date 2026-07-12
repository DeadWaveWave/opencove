import { fromFileUri } from '../../../../contexts/filesystem/domain/fileUri'
import type { AgentProviderId, LaunchAgentSessionInput } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import { normalizeLaunchAgentEnv } from './sessionLaunchAgentEnv'

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

export function normalizeLaunchAgentPayload(payload: unknown): LaunchAgentSessionInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (spaceIdRaw !== undefined && spaceIdRaw !== null && typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent spaceId.',
    })
  }

  const spaceId = typeof spaceIdRaw === 'string' ? spaceIdRaw.trim() : ''
  const cwdRaw = payload.cwd
  if (cwdRaw !== undefined && cwdRaw !== null && typeof cwdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent cwd.',
    })
  }

  const cwd = typeof cwdRaw === 'string' ? cwdRaw.trim() : ''
  const promptRaw = payload.prompt
  if (typeof promptRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent prompt.',
    })
  }

  const providerRaw = payload.provider
  if (providerRaw !== undefined && providerRaw !== null && typeof providerRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent provider.',
    })
  }

  const modelRaw = payload.model
  if (modelRaw !== undefined && modelRaw !== null && typeof modelRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent model.',
    })
  }

  const agentFullAccess = payload.agentFullAccess
  const modeRaw = payload.mode
  if (modeRaw !== undefined && modeRaw !== null && typeof modeRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent mode.',
    })
  }

  const resumeSessionIdRaw = payload.resumeSessionId
  if (
    resumeSessionIdRaw !== undefined &&
    resumeSessionIdRaw !== null &&
    typeof resumeSessionIdRaw !== 'string'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent resumeSessionId.',
    })
  }

  if (
    agentFullAccess !== undefined &&
    agentFullAccess !== null &&
    typeof agentFullAccess !== 'boolean'
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for session.launchAgent agentFullAccess.',
    })
  }

  if (spaceId.length === 0 && cwd.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'session.launchAgent requires either spaceId or cwd.',
    })
  }

  return {
    ...(spaceId.length > 0 ? { spaceId } : {}),
    ...(cwd.length > 0 ? { cwd } : {}),
    prompt: promptRaw.trim(),
    provider: normalizeAgentProviderId(providerRaw, 'session.launchAgent provider'),
    mode: modeRaw === 'resume' ? 'resume' : 'new',
    model: modelRaw === null ? null : normalizeOptionalString(modelRaw),
    resumeSessionId:
      resumeSessionIdRaw === null ? null : normalizeOptionalString(resumeSessionIdRaw),
    env: normalizeLaunchAgentEnv(payload.env),
    executablePathOverride:
      payload.executablePathOverride === undefined || payload.executablePathOverride === null
        ? null
        : normalizeOptionalString(payload.executablePathOverride),
    agentFullAccess: agentFullAccess ?? null,
    cols: normalizeOptionalPositiveInt(payload.cols),
    rows: normalizeOptionalPositiveInt(payload.rows),
  }
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
