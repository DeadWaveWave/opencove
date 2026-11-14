// @compat-file control-surface-legacy-validation
// Frozen from src/contexts/agent/presentation/main-ipc/validate.ts; provider from src/app/main/ipc/normalize.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; validator bodies verbatim, imports adjusted.
import type { ListAgentSessionsInput } from '../../../src/shared/contracts/dto'
import { AGENT_PROVIDER_IDS, type AgentProviderId } from '../../../src/shared/contracts/dto'
export function normalizeProvider(value: unknown): AgentProviderId {
  if (typeof value !== 'string' || !AGENT_PROVIDER_IDS.includes(value as AgentProviderId)) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid provider' })
  }

  return value as AgentProviderId
}

import { isAbsolute, win32 } from 'node:path'
import { createAppError } from '../../../src/shared/errors/appError'
function isAbsoluteWorkspacePath(path: string): boolean {
  return isAbsolute(path) || win32.isAbsolute(path)
}
const MAX_AGENT_SESSION_LIST_LIMIT = 100
export function normalizeListSessionsPayload(payload: unknown): ListAgentSessionsInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for agent:list-sessions',
    })
  }

  const record = payload as Record<string, unknown>
  const provider = normalizeProvider(record.provider)
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
  const rawLimit = record.limit

  if (cwd.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid cwd for agent:list-sessions',
    })
  }

  if (!isAbsoluteWorkspacePath(cwd)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'agent:list-sessions requires an absolute cwd',
    })
  }

  let limit: number | null = null
  if (rawLimit !== undefined && rawLimit !== null) {
    if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Invalid limit for agent:list-sessions',
      })
    }

    const normalizedLimit = Math.floor(rawLimit)
    if (normalizedLimit <= 0) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'agent:list-sessions requires a positive limit',
      })
    }

    limit = Math.min(normalizedLimit, MAX_AGENT_SESSION_LIST_LIMIT)
  }

  return {
    provider,
    cwd,
    limit,
  }
}
