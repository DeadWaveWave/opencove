import type {
  CreateGitWorktreeBranchMode,
  CreateGitWorktreeInput,
  GetGitStatusSummaryInput,
  ListGitBranchesInput,
  ListGitWorktreesInput,
  RemoveGitWorktreeInput,
  RenameGitBranchInput,
  SuggestWorktreeNamesInput,
} from '../../../../shared/contracts/dto'
import { isAbsolute } from 'node:path'
import type { AgentProviderId } from '../../../../shared/contracts/dto'
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

function normalizeProvider(value: unknown): AgentProviderId {
  if (value === 'codex' || value === 'claude-code') {
    return value
  }

  throw createAppError('common.invalid_input', { debugMessage: 'Invalid provider' })
}

function normalizeTasks(value: unknown): Array<{ title: string; requirement: string }> {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: Array<{ title: string; requirement: string }> = []

  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const record = item as Record<string, unknown>
    const title = normalizeTextValue(record.title)
    const requirement = normalizeTextValue(record.requirement)

    if (title.length === 0 && requirement.length === 0) {
      continue
    }

    normalized.push({
      title,
      requirement,
    })

    if (normalized.length >= 20) {
      break
    }
  }

  return normalized
}

function normalizeBranchMode(value: unknown): CreateGitWorktreeBranchMode {
  if (!value || typeof value !== 'object') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid branchMode' })
  }

  const record = value as Record<string, unknown>
  const kind = normalizeTextValue(record.kind)

  if (kind !== 'new' && kind !== 'existing') {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid branchMode.kind' })
  }

  const name = normalizeTextValue(record.name)
  if (name.length === 0) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid branchMode.name' })
  }

  if (kind === 'existing') {
    return { kind: 'existing', name }
  }

  const startPoint = normalizeTextValue(record.startPoint)
  if (startPoint.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid branchMode.startPoint',
    })
  }

  return { kind: 'new', name, startPoint }
}

export function normalizeListGitBranchesPayload(payload: unknown): ListGitBranchesInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:list-branches',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
  }
}

export function normalizeListGitWorktreesPayload(payload: unknown): ListGitWorktreesInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:list-worktrees',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
  }
}

export function normalizeGetGitStatusSummaryPayload(payload: unknown): GetGitStatusSummaryInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:list-status-summary',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
  }
}

export function normalizeCreateGitWorktreePayload(payload: unknown): CreateGitWorktreeInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:create',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    worktreesRoot: normalizeAbsolutePath(record.worktreesRoot, 'worktreesRoot'),
    branchMode: normalizeBranchMode(record.branchMode),
  }
}

export function normalizeRemoveGitWorktreePayload(payload: unknown): RemoveGitWorktreeInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:remove',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    worktreePath: normalizeAbsolutePath(record.worktreePath, 'worktreePath'),
    force: record.force === true,
    deleteBranch: record.deleteBranch === true,
  }
}

export function normalizeRenameGitBranchPayload(payload: unknown): RenameGitBranchInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:rename-branch',
    })
  }

  const record = payload as Record<string, unknown>
  return {
    repoPath: normalizeAbsolutePath(record.repoPath, 'repoPath'),
    worktreePath: normalizeAbsolutePath(record.worktreePath, 'worktreePath'),
    currentName: normalizeTextValue(record.currentName),
    nextName: normalizeTextValue(record.nextName),
  }
}

export function normalizeSuggestWorktreeNamesPayload(payload: unknown): SuggestWorktreeNamesInput {
  if (!payload || typeof payload !== 'object') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree:suggest-names',
    })
  }

  const record = payload as Record<string, unknown>
  const spaceName = normalizeTextValue(record.spaceName)
  if (spaceName.length === 0) {
    throw createAppError('common.invalid_input', { debugMessage: 'Invalid spaceName' })
  }

  const spaceNotes = normalizeTextValue(record.spaceNotes)
  const model = normalizeTextValue(record.model)

  return {
    provider: normalizeProvider(record.provider),
    cwd: normalizeAbsolutePath(record.cwd, 'cwd'),
    spaceName,
    spaceNotes: spaceNotes.length > 0 ? spaceNotes : null,
    tasks: normalizeTasks(record.tasks),
    model: model.length > 0 ? model : null,
  }
}
