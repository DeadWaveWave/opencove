import React from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpaceActionMenuState } from '../types'
import { getSpaceWorktreeEligibility } from '@contexts/space/application/spaceWorktreeEligibility'
import { resolveWorktreeRepoRootPath } from '@contexts/worktree/presentation/renderer/windows/spaceWorktree.shared'
import { normalizeComparablePath } from '../view/WorkspaceSpaceRegionsOverlay.helpers'
import { useWorktreeInfoByPath } from '../../../worktreeInfo/useWorktreeInfo'

interface CanvasArrangeFlags {
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  canArrangeActiveSpace: boolean
}

export const CLOSED_CANVAS_ARRANGE_FLAGS: CanvasArrangeFlags = {
  canArrangeAll: false,
  canArrangeCanvas: false,
  canArrangeActiveSpace: false,
}

export function resolveCanvasArrangeFlags(
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  activeMenuSpace: WorkspaceSpaceState | null,
): CanvasArrangeFlags {
  const ownedNodeIdSet = new Set(spaces.flatMap(space => space.nodeIds))
  const rootNodeCount = nodes.filter(node => !ownedNodeIdSet.has(node.id)).length
  const hasArrangeableSpace = spaces.some(space => space.nodeIds.length >= 1)
  const canArrangeCanvas = spaces.length + rootNodeCount >= 2
  return {
    canArrangeAll: canArrangeCanvas || hasArrangeableSpace,
    canArrangeCanvas,
    canArrangeActiveSpace: Boolean(activeMenuSpace && activeMenuSpace.nodeIds.length >= 1),
  }
}

export function useWorkspaceCanvasSpaceMenuState({
  spaceActionMenu,
  spaces,
  workspacePath,
}: {
  spaceActionMenu: SpaceActionMenuState | null
  spaces: WorkspaceSpaceState[]
  workspacePath: string
}): {
  activeMenuSpace: WorkspaceSpaceState | null
  canCreateWorktreeForActiveMenuSpace: boolean
} {
  const activeMenuSpace = React.useMemo(
    () =>
      spaceActionMenu
        ? (spaces.find(candidate => candidate.id === spaceActionMenu.spaceId) ?? null)
        : null,
    [spaceActionMenu, spaces],
  )

  const mountIdsKey = React.useMemo(() => {
    const unique = new Set<string>()
    spaces.forEach(space => {
      const mountId = space.targetMountId?.trim() ?? ''
      if (mountId.length > 0) {
        unique.add(mountId)
      }
    })

    return [...unique].sort((left, right) => left.localeCompare(right)).join('|')
  }, [spaces])

  const worktreeDirectoriesKey = React.useMemo(() => {
    const unique = new Set<string>()
    spaces.forEach(space => {
      const normalized = normalizeComparablePath(space.directoryPath)
      if (normalized.length > 0) {
        unique.add(normalized)
      }
    })

    return [...unique].sort((left, right) => left.localeCompare(right)).join('|')
  }, [spaces])

  const worktreeInfoByPath = useWorktreeInfoByPath({
    repoPath: workspacePath,
    mountIdsKey,
    refreshKey: worktreeDirectoriesKey,
  })
  const worktrees = React.useMemo(() => [...worktreeInfoByPath.values()], [worktreeInfoByPath])

  const worktreeRepoRootPath = React.useMemo(
    () =>
      activeMenuSpace?.targetMountId
        ? resolveWorktreeRepoRootPath(workspacePath, worktrees)
        : workspacePath,
    [activeMenuSpace?.targetMountId, workspacePath, worktrees],
  )

  const canCreateWorktreeForActiveMenuSpace = React.useMemo(
    () =>
      getSpaceWorktreeEligibility({
        space: activeMenuSpace,
        spaces,
        worktrees,
        repoRootPath: worktreeRepoRootPath,
      }).canCreate,
    [activeMenuSpace, spaces, worktreeRepoRootPath, worktrees],
  )

  return {
    activeMenuSpace,
    canCreateWorktreeForActiveMenuSpace,
  }
}
