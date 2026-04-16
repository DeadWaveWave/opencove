import { useMemo } from 'react'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import { resolveGitWorktreeApiForMount } from './mountAwareGitWorktreeApi'
import {
  normalizeComparablePath,
  resolveWorktreeRepoRootPath,
  resolveWorktreesRoot,
  type SpaceWorktreeViewMode,
} from './spaceWorktree.shared'
import { getSpaceArchiveCounts, resolveSpaceWorktreeStatusPath } from './spaceWorktreeWindowState'
import { resolveSpaceTasks } from './resolveSpaceTasks'

export function useSpaceWorktreeDerivedState({
  spaceId,
  spaces,
  worktrees,
  nodes,
  workspacePath,
  worktreesRoot,
  initialViewMode,
}: {
  spaceId: string | null
  spaces: WorkspaceSpaceState[]
  worktrees: GitWorktreeInfo[]
  nodes: Node<TerminalNodeData>[]
  workspacePath: string
  worktreesRoot: string
  initialViewMode: SpaceWorktreeViewMode
}) {
  const space = useMemo(
    () => (spaceId ? (spaces.find(candidate => candidate.id === spaceId) ?? null) : null),
    [spaceId, spaces],
  )

  const worktreeApi = useMemo(
    () => resolveGitWorktreeApiForMount(space?.targetMountId ?? null),
    [space?.targetMountId],
  )

  const worktreeRepoRootPath = useMemo(
    () =>
      space?.targetMountId ? resolveWorktreeRepoRootPath(workspacePath, worktrees) : workspacePath,
    [space?.targetMountId, workspacePath, worktrees],
  )

  const resolvedWorktreesRoot = useMemo(
    () => resolveWorktreesRoot(worktreeRepoRootPath, worktreesRoot),
    [worktreeRepoRootPath, worktreesRoot],
  )

  const normalizedWorkspacePath = useMemo(
    () => normalizeComparablePath(worktreeRepoRootPath),
    [worktreeRepoRootPath],
  )

  const normalizedSpaceDirectory = useMemo(
    () => normalizeComparablePath(space?.directoryPath ?? worktreeRepoRootPath),
    [space?.directoryPath, worktreeRepoRootPath],
  )

  const isSpaceOnWorkspaceRoot = normalizedSpaceDirectory === normalizedWorkspacePath

  const currentWorktree = useMemo(
    () =>
      worktrees.find(entry => normalizeComparablePath(entry.path) === normalizedSpaceDirectory) ??
      null,
    [normalizedSpaceDirectory, worktrees],
  )

  const branchesWithWorktrees = useMemo(() => {
    const candidates = worktrees
      .map(entry => entry.branch?.trim())
      .filter((branch): branch is string => Boolean(branch && branch.length > 0))
    return new Set(candidates)
  }, [worktrees])

  const statusPath = useMemo(
    () =>
      resolveSpaceWorktreeStatusPath({
        workspacePath: worktreeRepoRootPath,
        isSpaceOnWorkspaceRoot,
        currentWorktree,
        spaceDirectoryPath: space?.directoryPath,
      }),
    [currentWorktree, isSpaceOnWorkspaceRoot, space?.directoryPath, worktreeRepoRootPath],
  )

  const spaceTasks = useMemo(() => resolveSpaceTasks(space, nodes), [nodes, space])
  const archiveCounts = useMemo(() => getSpaceArchiveCounts({ space, nodes }), [nodes, space])

  return {
    archiveCounts,
    branchesWithWorktrees,
    currentWorktree,
    isSpaceOnWorkspaceRoot,
    resolvedInitialViewMode: initialViewMode,
    resolvedWorktreesRoot,
    space,
    spaceTasks,
    statusPath,
    worktreeApi,
    worktreeRepoRootPath,
  }
}
