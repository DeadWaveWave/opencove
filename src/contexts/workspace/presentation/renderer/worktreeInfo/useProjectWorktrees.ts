import { useMemo } from 'react'
import type { GitWorktreeInfo } from '@shared/contracts/dto'
import type { WorkspaceState } from '../types'
import { useWorktreeInfoByPath } from './useWorktreeInfo'

/**
 * A project's worktrees for the sidebar, from the shared listing: every sidebar reader passes the
 * same repository and mount set, so they share one listing (and the canvas's, for the same set).
 */
export function useProjectWorktrees(workspace: WorkspaceState): GitWorktreeInfo[] {
  const mountIdsKey = useMemo(
    () =>
      [...new Set(workspace.spaces.map(space => space.targetMountId?.trim() ?? '').filter(Boolean))]
        .sort()
        .join('|'),
    [workspace.spaces],
  )
  const directoriesKey = useMemo(
    () => workspace.spaces.map(space => space.directoryPath).join('\n'),
    [workspace.spaces],
  )
  const worktreeInfo = useWorktreeInfoByPath({
    repoPath: workspace.path,
    mountIdsKey,
    refreshKey: directoriesKey,
  })
  return useMemo(() => [...worktreeInfo.values()], [worktreeInfo])
}
