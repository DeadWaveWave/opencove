import React from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpaceActionMenuState } from '../types'

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

export function useWorkspaceCanvasSpaceMenuState({
  spaceActionMenu,
  spaces,
  workspacePath,
  nodes,
}: {
  spaceActionMenu: SpaceActionMenuState | null
  spaces: WorkspaceSpaceState[]
  workspacePath: string
  nodes: Node<TerminalNodeData>[]
}): {
  activeMenuSpace: WorkspaceSpaceState | null
  isActiveMenuSpaceOnWorkspaceRoot: boolean
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  canArrangeActiveSpace: boolean
} {
  const activeMenuSpace = React.useMemo(
    () =>
      spaceActionMenu
        ? (spaces.find(candidate => candidate.id === spaceActionMenu.spaceId) ?? null)
        : null,
    [spaceActionMenu, spaces],
  )

  const normalizedWorkspacePath = React.useMemo(
    () => normalizeComparablePath(workspacePath),
    [workspacePath],
  )

  const activeMenuSpacePath = React.useMemo(() => {
    if (!activeMenuSpace) {
      return workspacePath
    }

    const trimmed = activeMenuSpace.directoryPath.trim()
    return trimmed.length > 0 ? trimmed : workspacePath
  }, [activeMenuSpace, workspacePath])

  const isActiveMenuSpaceOnWorkspaceRoot =
    normalizeComparablePath(activeMenuSpacePath) === normalizedWorkspacePath

  const ownedNodeIdSet = React.useMemo(
    () => new Set(spaces.flatMap(space => space.nodeIds)),
    [spaces],
  )
  const rootNodeCount = React.useMemo(
    () => nodes.filter(node => !ownedNodeIdSet.has(node.id)).length,
    [nodes, ownedNodeIdSet],
  )
  const canArrangeCanvas = spaces.length + rootNodeCount >= 2
  const canArrangeAll = canArrangeCanvas || spaces.some(space => space.nodeIds.length >= 2)
  const canArrangeActiveSpace = Boolean(activeMenuSpace && activeMenuSpace.nodeIds.length >= 2)

  return {
    activeMenuSpace,
    isActiveMenuSpaceOnWorkspaceRoot,
    canArrangeAll,
    canArrangeCanvas,
    canArrangeActiveSpace,
  }
}
