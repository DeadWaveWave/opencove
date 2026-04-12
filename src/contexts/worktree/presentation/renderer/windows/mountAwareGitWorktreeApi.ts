import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type {
  CreateGitWorktreeInput,
  CreateGitWorktreeResult,
  GetGitDefaultBranchInput,
  GetGitDefaultBranchResult,
  GetGitStatusSummaryInput,
  GetGitStatusSummaryResult,
  ListGitBranchesInput,
  ListGitBranchesResult,
  ListGitWorktreesInput,
  ListGitWorktreesResult,
  RemoveGitWorktreeInput,
  RemoveGitWorktreeResult,
  RenameGitBranchInput,
  SuggestWorktreeNamesInput,
  SuggestWorktreeNamesResult,
} from '@shared/contracts/dto'

type WorktreeApiClient = Window['opencoveApi']['worktree']

function resolveControlSurfaceInvoke(): ((request: unknown) => Promise<unknown>) | null {
  const invoke = (window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } })
    .opencoveApi?.controlSurface?.invoke

  return typeof invoke === 'function' ? (invoke as (request: unknown) => Promise<unknown>) : null
}

export function resolveGitWorktreeApiForMount(mountId: string | null): WorktreeApiClient | null {
  const controlSurfaceInvoke = resolveControlSurfaceInvoke()

  if (mountId && controlSurfaceInvoke) {
    return {
      listBranches: async (_payload: ListGitBranchesInput): Promise<ListGitBranchesResult> =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'gitWorktree.listBranchesInMount',
          payload: { mountId },
        }),
      listWorktrees: async (_payload: ListGitWorktreesInput): Promise<ListGitWorktreesResult> =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'gitWorktree.listWorktreesInMount',
          payload: { mountId },
        }),
      statusSummary: async (
        payload: GetGitStatusSummaryInput,
      ): Promise<GetGitStatusSummaryResult> =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'gitWorktree.statusSummaryInMount',
          payload: { mountId, uri: toFileUri(payload.repoPath) },
        }),
      getDefaultBranch: async (
        _payload: GetGitDefaultBranchInput,
      ): Promise<GetGitDefaultBranchResult> =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'query',
          id: 'gitWorktree.getDefaultBranchInMount',
          payload: { mountId },
        }),
      create: async (payload: CreateGitWorktreeInput): Promise<CreateGitWorktreeResult> =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'gitWorktree.createInMount',
          payload: {
            mountId,
            worktreesRootUri: toFileUri(payload.worktreesRoot),
            branchMode: payload.branchMode,
          },
        }),
      remove: async (payload: RemoveGitWorktreeInput): Promise<RemoveGitWorktreeResult> =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'gitWorktree.removeInMount',
          payload: {
            mountId,
            worktreeUri: toFileUri(payload.worktreePath),
            force: payload.force,
            deleteBranch: payload.deleteBranch,
          },
        }),
      renameBranch: async (payload: RenameGitBranchInput): Promise<void> => {
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'gitWorktree.renameBranchInMount',
          payload: {
            mountId,
            worktreeUri: toFileUri(payload.worktreePath),
            currentName: payload.currentName,
            nextName: payload.nextName,
          },
        })
      },
      // Keep AI naming suggestions local (runs via opencode/CLI on the desktop).
      suggestNames: async (
        payload: SuggestWorktreeNamesInput,
      ): Promise<SuggestWorktreeNamesResult> =>
        await window.opencoveApi.worktree.suggestNames(payload),
    }
  }

  return window.opencoveApi?.worktree ?? null
}
