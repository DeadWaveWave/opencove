// Frozen oracle: copied from src/app/main/controlSurface/handlers/worktreeHandlers.ts at 1d7052a7f3ee615791db337d2f6a21580adad421; do not edit; delete when the parity window closes.
import { createAppError } from '../../../src/shared/errors/appError'
import type {
  ListWorktreesInput,
  CreateWorktreeInput,
  ArchiveWorktreeInput,
} from '../../../src/shared/contracts/dto'
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

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

export function normalizeListWorktreesPayload(payload: unknown): ListWorktreesInput {
  if (payload === null || payload === undefined) {
    return { projectId: null }
  }

  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.list.',
    })
  }

  const projectId = normalizeOptionalString(payload.projectId)
  return { projectId }
}

export function normalizeCreateWorktreePayload(payload: unknown): CreateWorktreeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.create.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.create spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for worktree.create spaceId.',
    })
  }

  return {
    spaceId,
    name: normalizeOptionalString(payload.name),
  }
}

export function normalizeArchiveWorktreePayload(payload: unknown): ArchiveWorktreeInput {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.archive.',
    })
  }

  const spaceIdRaw = payload.spaceId
  if (typeof spaceIdRaw !== 'string') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.archive spaceId.',
    })
  }

  const spaceId = spaceIdRaw.trim()
  if (spaceId.length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Missing payload for worktree.archive spaceId.',
    })
  }

  const force = payload.force
  if (force !== undefined && force !== null && typeof force !== 'boolean') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.archive force.',
    })
  }

  const deleteBranch = payload.deleteBranch
  if (deleteBranch !== undefined && deleteBranch !== null && typeof deleteBranch !== 'boolean') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for worktree.archive deleteBranch.',
    })
  }

  return {
    spaceId,
    force: force ?? null,
    deleteBranch: deleteBranch ?? null,
  }
}
