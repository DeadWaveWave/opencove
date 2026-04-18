import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import type {
  ArchiveWorktreeInput,
  ArchiveWorktreeResult,
  CreateWorktreeInput,
  CreateWorktreeResult,
  ListWorktreesInput,
  ListWorktreesResult,
} from '../../../../shared/contracts/dto'
import type { GitWorktreePort } from '../../../../contexts/worktree/application/ports'
import {
  createGitWorktreeUseCase,
  listGitWorktreesUseCase,
  removeGitWorktreeUseCase,
} from '../../../../contexts/worktree/application/usecases'
import {
  createGitWorktree,
  getGitStatusSummary,
  listGitBranches,
  listGitWorktrees,
  removeGitWorktree,
  renameGitBranch,
} from '../../../../contexts/worktree/infrastructure/git/GitWorktreeService'
import { getGitDefaultBranch } from '../../../../contexts/worktree/infrastructure/git/GitWorktreeDefaultBranch'
import { suggestWorktreeNames } from '../../../../contexts/worktree/infrastructure/git/WorktreeNameSuggester'
import { computeSpaceDirectoryUpdate } from '../../../../contexts/space/application/updateSpaceDirectory'
import { resolveWorktreesRoot } from '../../../../contexts/worktree/application/resolveWorktreesRoot'
import { randomUUID } from 'node:crypto'

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

function normalizeListWorktreesPayload(payload: unknown): ListWorktreesInput {
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

function normalizeCreateWorktreePayload(payload: unknown): CreateWorktreeInput {
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

function normalizeArchiveWorktreePayload(payload: unknown): ArchiveWorktreeInput {
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

function resolveCandidateBranchName(spaceName: string, nameOverride: string | null): string {
  const base = nameOverride?.trim() || spaceName.trim()
  const slug = base
    .toLowerCase()
    .replace(/[\s._/\\]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

  return slug.length > 0 ? slug : `space-${randomUUID().slice(0, 8)}`
}

async function persistNextAppState(store: PersistenceStore, nextState: unknown): Promise<void> {
  const result = await store.writeAppState(nextState)
  if (!result.ok) {
    throw createAppError(result.error)
  }
}

function createDefaultGitWorktreePort(): GitWorktreePort {
  return {
    listBranches: async input => await listGitBranches(input),
    listWorktrees: async input => await listGitWorktrees(input),
    getStatusSummary: async input => await getGitStatusSummary(input),
    getDefaultBranch: async input => await getGitDefaultBranch(input),
    createWorktree: async input => await createGitWorktree(input),
    removeWorktree: async input => await removeGitWorktree(input),
    renameBranch: async input => await renameGitBranch(input),
    suggestNames: async input => await suggestWorktreeNames(input),
  }
}

export function registerWorktreeHandlers(
  controlSurface: ControlSurface,
  deps: {
    approvedWorkspaces: ApprovedWorkspaceStore
    getPersistenceStore: () => Promise<PersistenceStore>
    gitWorktreePort?: GitWorktreePort
  },
): void {
  const gitWorktreePort = deps.gitWorktreePort ?? createDefaultGitWorktreePort()

  controlSurface.register('worktree.list', {
    kind: 'query',
    validate: normalizeListWorktreesPayload,
    handle: async (_ctx, payload): Promise<ListWorktreesResult> => {
      const store = await deps.getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())

      const activeProjectId = normalized?.activeWorkspaceId ?? null
      const requestedProjectId = payload.projectId ?? null
      const effectiveProjectId = requestedProjectId ?? activeProjectId

      const workspace =
        effectiveProjectId && normalized
          ? (normalized.workspaces.find(item => item.id === effectiveProjectId) ?? null)
          : null

      if (!workspace) {
        return { projectId: effectiveProjectId, repoPath: null, worktreesRoot: null, worktrees: [] }
      }

      const repoPath = workspace.path
      const worktreesRoot = resolveWorktreesRoot(workspace.path, workspace.worktreesRoot)

      const [repoApproved, worktreesRootApproved] = await Promise.all([
        deps.approvedWorkspaces.isPathApproved(repoPath),
        deps.approvedWorkspaces.isPathApproved(worktreesRoot),
      ])

      if (!repoApproved || !worktreesRootApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree.list repo path is outside approved roots',
        })
      }

      const listResult = await listGitWorktreesUseCase(gitWorktreePort, { repoPath })
      return {
        projectId: workspace.id,
        repoPath,
        worktreesRoot,
        worktrees: listResult.worktrees,
      }
    },
    defaultErrorCode: 'worktree.list_worktrees_failed',
  })

  controlSurface.register('worktree.create', {
    kind: 'command',
    validate: normalizeCreateWorktreePayload,
    handle: async (_ctx, payload): Promise<CreateWorktreeResult> => {
      const store = await deps.getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspaces = normalized?.workspaces ?? []

      let matched: {
        workspace: (typeof workspaces)[number]
        space: (typeof workspaces)[number]['spaces'][number]
      } | null = null
      for (const workspace of workspaces) {
        const space = workspace.spaces.find(candidate => candidate.id === payload.spaceId) ?? null
        if (!space) {
          continue
        }

        matched = { workspace, space }
        break
      }

      if (!matched) {
        throw createAppError('space.not_found', {
          debugMessage: `worktree.create: unknown space id: ${payload.spaceId}`,
        })
      }

      const { workspace, space } = matched

      const effectiveDirectory = space.directoryPath.trim().length > 0 ? space.directoryPath : ''
      if (effectiveDirectory && effectiveDirectory !== workspace.path) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'worktree.create requires a root-bound space (directoryPath matches repo).',
        })
      }

      const repoPath = workspace.path
      const worktreesRoot = resolveWorktreesRoot(workspace.path, workspace.worktreesRoot)

      const [repoApproved, worktreesRootApproved] = await Promise.all([
        deps.approvedWorkspaces.isPathApproved(repoPath),
        deps.approvedWorkspaces.isPathApproved(worktreesRoot),
      ])

      if (!repoApproved || !worktreesRootApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree.create path is outside approved roots',
        })
      }

      const branchName = resolveCandidateBranchName(space.name, payload.name ?? null)
      const created = await createGitWorktreeUseCase(gitWorktreePort, {
        repoPath,
        worktreesRoot,
        branchMode: { kind: 'new', name: branchName, startPoint: 'HEAD' },
      })

      const nextSpaceName = created.worktree.branch?.trim() || branchName
      const update = computeSpaceDirectoryUpdate({
        workspacePath: workspace.path,
        spaces: workspace.spaces,
        spaceId: space.id,
        directoryPath: created.worktree.path,
        options: { renameSpaceTo: nextSpaceName },
      })

      if (!update) {
        throw createAppError('space.not_found', {
          debugMessage: `worktree.create: space not found after creation: ${payload.spaceId}`,
        })
      }

      const nextWorkspace = {
        ...workspace,
        spaces: update.nextSpaces,
      }

      const nextState = normalized
        ? {
            ...normalized,
            workspaces: normalized.workspaces.map(candidate =>
              candidate.id === workspace.id ? nextWorkspace : candidate,
            ),
          }
        : null

      if (!nextState) {
        throw createAppError('persistence.invalid_state', {
          debugMessage: 'worktree.create: missing persisted app state.',
        })
      }

      await persistNextAppState(store, nextState)

      return {
        projectId: workspace.id,
        activeSpaceId: workspace.activeSpaceId,
        spaceId: space.id,
        worktree: created.worktree,
        spaceDirectoryPath: created.worktree.path,
        spaceName: nextSpaceName,
      }
    },
    defaultErrorCode: 'worktree.create_failed',
  })

  controlSurface.register('worktree.archive', {
    kind: 'command',
    validate: normalizeArchiveWorktreePayload,
    handle: async (_ctx, payload): Promise<ArchiveWorktreeResult> => {
      const store = await deps.getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspaces = normalized?.workspaces ?? []

      let matched: {
        workspace: (typeof workspaces)[number]
        space: (typeof workspaces)[number]['spaces'][number]
      } | null = null
      for (const workspace of workspaces) {
        const space = workspace.spaces.find(candidate => candidate.id === payload.spaceId) ?? null
        if (!space) {
          continue
        }

        matched = { workspace, space }
        break
      }

      if (!matched) {
        throw createAppError('space.not_found', {
          debugMessage: `worktree.archive: unknown space id: ${payload.spaceId}`,
        })
      }

      const { workspace, space } = matched

      const repoPath = workspace.path
      const worktreePath = space.directoryPath
      const isSpaceOnWorkspaceRoot = worktreePath === repoPath

      const [repoApproved, worktreeApproved] = await Promise.all([
        deps.approvedWorkspaces.isPathApproved(repoPath),
        deps.approvedWorkspaces.isPathApproved(worktreePath),
      ])

      if (!repoApproved || !worktreeApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'worktree.archive path is outside approved roots',
        })
      }

      const removed = isSpaceOnWorkspaceRoot
        ? null
        : await removeGitWorktreeUseCase(gitWorktreePort, {
            repoPath,
            worktreePath,
            force: payload.force ?? undefined,
            deleteBranch: payload.deleteBranch ?? undefined,
          })

      const update = computeSpaceDirectoryUpdate({
        workspacePath: workspace.path,
        spaces: workspace.spaces,
        spaceId: space.id,
        directoryPath: workspace.path,
      })

      if (!update) {
        throw createAppError('space.not_found', {
          debugMessage: `worktree.archive: space not found after archive: ${payload.spaceId}`,
        })
      }

      const nextWorkspace = {
        ...workspace,
        spaces: update.nextSpaces,
      }

      const nextState = normalized
        ? {
            ...normalized,
            workspaces: normalized.workspaces.map(candidate =>
              candidate.id === workspace.id ? nextWorkspace : candidate,
            ),
          }
        : null

      if (!nextState) {
        throw createAppError('persistence.invalid_state', {
          debugMessage: 'worktree.archive: missing persisted app state.',
        })
      }

      await persistNextAppState(store, nextState)

      return {
        projectId: workspace.id,
        activeSpaceId: workspace.activeSpaceId,
        spaceId: space.id,
        removed,
        spaceDirectoryPath: workspace.path,
      }
    },
    defaultErrorCode: 'worktree.remove_failed',
  })
}
