import { isAbsolute } from 'node:path'
import type { ResolveGitHubPullRequestsInput } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'

function normalizeTextValue(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function normalizeAbsolutePath(value: unknown, label: string): string {
  const normalized = normalizeTextValue(value)
  if (normalized.length === 0) {
    throw createAppError('common.invalid_input', { debugMessage: `Invalid ${label}` })
  }

  if (!isAbsolute(normalized)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `${label} must be an absolute path`,
    })
  }

  return normalized
}

function normalizeBranches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const item of value) {
    const branch = normalizeTextValue(item)
    if (branch.length === 0) {
      continue
    }

    normalized.push(branch)
    if (normalized.length >= 40) {
      break
    }
  }

  return normalized
}

export function normalizeResolveGitHubPullRequestsPayload(
  payload: unknown,
): ResolveGitHubPullRequestsInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for integration:github:resolve-pull-requests',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    branches: normalizeBranches(record.branches),
  }
}
