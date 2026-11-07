// Frozen validator bodies from src/app/main/controlSurface/handlers/gitWorktreeMountReadHandlers.ts at 6df96903c64d6fb3c541c79815713996d3c1b186; imports relocated only.
import { createAppError } from '../../../src/shared/errors/appError'
import { isRecord, normalizeFileSystemUri, normalizeMountId } from './migAMountSupport'

export const normalizeGitWorktreeListBranchesInMount = (payload: unknown): { mountId: string } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.listBranchesInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.listBranchesInMount'),
  }
}
export const normalizeGitWorktreeListWorktreesInMount = (payload: unknown): { mountId: string } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.listWorktreesInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.listWorktreesInMount'),
  }
}
export const normalizeGitWorktreeStatusSummaryInMount = (
  payload: unknown,
): { mountId: string; uri: string } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.statusSummaryInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.statusSummaryInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'gitWorktree.statusSummaryInMount'),
  }
}
export const normalizeGitWorktreeGetDefaultBranchInMount = (
  payload: unknown,
): { mountId: string } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.getDefaultBranchInMount.',
    })
  }

  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.getDefaultBranchInMount'),
  }
}
export const normalizeGitWorktreeGraphInMount = (
  payload: unknown,
): { mountId: string; uri: string; limit?: number } => {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for gitWorktree.graphInMount.',
    })
  }
  return {
    mountId: normalizeMountId(payload.mountId, 'gitWorktree.graphInMount'),
    uri: normalizeFileSystemUri(payload.uri, 'gitWorktree.graphInMount'),
    limit: typeof payload.limit === 'number' ? payload.limit : undefined,
  }
}
