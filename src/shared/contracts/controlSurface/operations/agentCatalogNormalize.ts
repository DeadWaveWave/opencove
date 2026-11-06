import type { ListAgentSessionsInput } from '../../dto'
import { normalizeProvider } from '../../normalizeAgentProvider'
import { isAbsolute, win32 } from 'node:path'
import { createAppError } from '../../../errors/appError'
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
