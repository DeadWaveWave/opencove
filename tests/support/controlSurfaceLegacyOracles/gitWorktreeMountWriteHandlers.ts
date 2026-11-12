// Frozen validator bodies from src/app/main/controlSurface/handlers/gitWorktreeMountWriteHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; imports relocated only.
import type { CreateGitWorktreeBranchMode } from '../../../src/shared/contracts/dto'
import { createAppError } from '../../../src/shared/errors/appError'
import { isRecord, normalizeFileSystemUri, normalizeMountId } from './filesystemMountSupport'
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

function normalizeRequiredString(value: unknown, debugName: string): string {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Missing payload for ${debugName}.`,
    })
  }

  return normalized
}

function normalizeBranchMode(value: unknown, operationId: string): CreateGitWorktreeBranchMode {
  if (!isRecord(value)) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.`,
    })
  }

  const kind = normalizeOptionalString(value.kind)
  if (kind !== 'new' && kind !== 'existing') {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.kind.`,
    })
  }

  const name = normalizeOptionalString(value.name)
  if (!name) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.name.`,
    })
  }

  if (kind === 'existing') {
    return { kind: 'existing', name }
  }

  const startPoint = normalizeOptionalString(value.startPoint)
  if (!startPoint) {
    throw createAppError('common.invalid_input', {
      debugMessage: `Invalid payload for ${operationId} branchMode.startPoint.`,
    })
  }

  return { kind: 'new', name, startPoint }
}

export const normalizeGitWorktreeCreateInMount = (
  payload: unknown,
): { mountId: string; worktreesRootUri: string; branchMode: CreateGitWorktreeBranchMode } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.createInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.createInMount'),
    worktreesRootUri: normalizeFileSystemUri(
      payload.worktreesRootUri,
      'gitWorktree.createInMount.worktreesRootUri',
    ),
    branchMode: normalizeBranchMode(payload.branchMode, 'gitWorktree.createInMount'),
  }
}
export const normalizeGitWorktreeRemoveInMount = (
  payload: unknown,
): { mountId: string; worktreeUri: string; force: boolean; deleteBranch: boolean } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.removeInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.removeInMount'),
    worktreeUri: normalizeFileSystemUri(
      payload.worktreeUri,
      'gitWorktree.removeInMount.worktreeUri',
    ),
    force: payload.force === true,
    deleteBranch: payload.deleteBranch === true,
  }
}
export const normalizeGitWorktreeRenameBranchInMount = (
  payload: unknown,
): {
  mountId: string
  worktreeUri: string
  currentName: string
  nextName: string
} => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.renameBranchInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.renameBranchInMount'),
    worktreeUri: normalizeFileSystemUri(
      payload.worktreeUri,
      'gitWorktree.renameBranchInMount.worktreeUri',
    ),
    currentName: normalizeRequiredString(
      payload.currentName,
      'gitWorktree.renameBranchInMount currentName',
    ),
    nextName: normalizeRequiredString(payload.nextName, 'gitWorktree.renameBranchInMount nextName'),
  }
}
