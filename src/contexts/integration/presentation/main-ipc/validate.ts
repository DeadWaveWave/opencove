import { isAbsolute } from 'node:path'
import type {
  ExecuteGitHubPullRequestActionInput,
  GetGitHubPullRequestChecksInput,
  GetGitHubPullRequestDiffInput,
  GetGitHubPullRequestInput,
  GitHubPullRequestAction,
  GitHubPullRequestReviewEvent,
  GitHubPullRequestSelector,
  ResolveGitHubPullRequestsInput,
} from '../../../../shared/contracts/dto'
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

function normalizeSelector(value: unknown): GitHubPullRequestSelector {
  if (!value || typeof value !== 'object') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid selector' })
  }

  const record = value as Record<string, unknown>
  const kind = normalizeTextValue(record.kind)

  if (kind === 'branch') {
    const branch = normalizeTextValue(record.branch)
    if (branch.length === 0) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid selector.branch' })
    }

    return { kind: 'branch', branch }
  }

  if (kind === 'number') {
    const number = typeof record.number === 'number' ? record.number : null
    if (!number || !Number.isFinite(number) || number <= 0) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid selector.number' })
    }

    return { kind: 'number', number }
  }

  if (kind === 'url') {
    const url = normalizeTextValue(record.url)
    if (url.length === 0) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid selector.url' })
    }

    return { kind: 'url', url }
  }

  throw createAppError('common.invalid_input', { debugMessage: 'Invalid selector.kind' })
}

function normalizeReviewEvent(value: unknown): GitHubPullRequestReviewEvent {
  const normalized = normalizeTextValue(value)
  if (normalized === 'approve' || normalized === 'request_changes' || normalized === 'comment') {
    return normalized
  }

  throw createAppError('common.invalid_input', { debugMessage: 'Invalid review event' })
}

function normalizeAction(value: unknown): GitHubPullRequestAction {
  if (!value || typeof value !== 'object') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid action' })
  }

  const record = value as Record<string, unknown>
  const kind = normalizeTextValue(record.kind)

  if (kind === 'publish_branch') {
    const branch = normalizeTextValue(record.branch)
    if (branch.length === 0) {
      throw createAppError('common.invalid_input', {
        debugMessage: 'Invalid publish_branch.branch',
      })
    }

    const remote = normalizeTextValue(record.remote)
    return { kind: 'publish_branch', branch, remote: remote.length > 0 ? remote : null }
  }

  if (kind === 'create') {
    const branch = normalizeTextValue(record.branch)
    const title = normalizeTextValue(record.title)
    const body = typeof record.body === 'string' ? record.body : ''
    const base = normalizeTextValue(record.base)
    const draft = record.draft === true

    if (branch.length === 0 || title.length === 0) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid create payload' })
    }

    return {
      kind: 'create',
      branch,
      title,
      body,
      base: base.length > 0 ? base : null,
      draft,
    }
  }

  if (kind === 'set_ready') {
    return {
      kind: 'set_ready',
      selector: normalizeSelector(record.selector),
      isDraft: record.isDraft === true,
    }
  }

  if (kind === 'merge') {
    const method = normalizeTextValue(record.method)
    if (method !== 'merge' && method !== 'rebase' && method !== 'squash') {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid merge method' })
    }

    const subject = normalizeTextValue(record.subject)
    const body = normalizeTextValue(record.body)

    return {
      kind: 'merge',
      selector: normalizeSelector(record.selector),
      method,
      auto: record.auto === true,
      deleteBranch: record.deleteBranch === true,
      subject: subject.length > 0 ? subject : null,
      body: body.length > 0 ? body : null,
      admin: record.admin === true,
    }
  }

  if (kind === 'close') {
    const comment = normalizeTextValue(record.comment)
    return {
      kind: 'close',
      selector: normalizeSelector(record.selector),
      deleteBranch: record.deleteBranch === true,
      comment: comment.length > 0 ? comment : null,
    }
  }

  if (kind === 'reopen') {
    return {
      kind: 'reopen',
      selector: normalizeSelector(record.selector),
    }
  }

  if (kind === 'comment') {
    const body = typeof record.body === 'string' ? record.body : ''
    if (body.trim().length === 0) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid comment body' })
    }

    return {
      kind: 'comment',
      selector: normalizeSelector(record.selector),
      body,
    }
  }

  if (kind === 'review') {
    const body = typeof record.body === 'string' ? record.body : ''
    if (body.trim().length === 0) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid review body' })
    }

    return {
      kind: 'review',
      selector: normalizeSelector(record.selector),
      event: normalizeReviewEvent(record.event),
      body,
    }
  }

  throw createAppError('common.invalid_input', { debugMessage: 'Invalid action.kind' })
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

export function normalizeGetGitHubPullRequestPayload(payload: unknown): GetGitHubPullRequestInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for integration:github:get-pull-request',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    selector: normalizeSelector(record.selector),
  }
}

export function normalizeGetGitHubPullRequestChecksPayload(
  payload: unknown,
): GetGitHubPullRequestChecksInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for integration:github:get-pull-request-checks',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    selector: normalizeSelector(record.selector),
    required: record.required === true,
  }
}

export function normalizeGetGitHubPullRequestDiffPayload(
  payload: unknown,
): GetGitHubPullRequestDiffInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for integration:github:get-pull-request-diff',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    selector: normalizeSelector(record.selector),
  }
}

export function normalizeExecuteGitHubPullRequestActionPayload(
  payload: unknown,
): ExecuteGitHubPullRequestActionInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for integration:github:execute-pull-request-action',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    action: normalizeAction(record.action),
  }
}
