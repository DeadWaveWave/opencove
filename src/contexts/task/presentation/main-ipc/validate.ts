import type { SuggestTaskTitleInput } from '../../../../shared/contracts/dto'
import { normalizeProvider, normalizeStringArray } from '../../../../app/main/ipc/normalize'
import { isAbsolute } from 'node:path'
import { isTaskTitleAgentProvider } from '../../../settings/domain/agentSettings'

export function normalizeSuggestTaskTitlePayload(payload: unknown): SuggestTaskTitleInput {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload for task:suggest-title')
  }

  const record = payload as Record<string, unknown>

  const provider = normalizeProvider(record.provider)
  const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
  const requirement = typeof record.requirement === 'string' ? record.requirement.trim() : ''
  const model = typeof record.model === 'string' ? record.model.trim() : ''
  const availableTags = normalizeStringArray(record.availableTags)

  if (cwd.length === 0) {
    throw new Error('Invalid cwd for task:suggest-title')
  }

  if (!isAbsolute(cwd)) {
    throw new Error('task:suggest-title requires an absolute cwd')
  }

  if (requirement.length === 0) {
    throw new Error('Invalid requirement for task:suggest-title')
  }

  if (!isTaskTitleAgentProvider(provider)) {
    throw new Error('Invalid provider for task:suggest-title')
  }

  return {
    provider,
    cwd,
    requirement,
    model: model.length > 0 ? model : null,
    availableTags,
  }
}
