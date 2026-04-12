import React from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpaceActionMenuState } from '../types'
import type { ResolveMountTargetResult } from '@shared/contracts/dto'

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

function resolveControlSurfaceInvoke(): ((request: unknown) => Promise<unknown>) | null {
  const invoke = (window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } })
    .opencoveApi?.controlSurface?.invoke

  return typeof invoke === 'function' ? (invoke as (request: unknown) => Promise<unknown>) : null
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

  const [resolvedMountRootPath, setResolvedMountRootPath] = React.useState<string | null>(null)

  React.useEffect(() => {
    setResolvedMountRootPath(null)

    const mountId = activeMenuSpace?.targetMountId
    if (!mountId) {
      return
    }

    const invoke = resolveControlSurfaceInvoke()
    if (!invoke) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const result = (await invoke({
          kind: 'query',
          id: 'mountTarget.resolve',
          payload: { mountId },
        })) as ResolveMountTargetResult

        if (cancelled) {
          return
        }

        setResolvedMountRootPath(typeof result?.rootPath === 'string' ? result.rootPath : null)
      } catch {
        if (cancelled) {
          return
        }

        setResolvedMountRootPath(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeMenuSpace?.targetMountId])

  const workspaceRootForComparison = React.useMemo(() => {
    if (activeMenuSpace?.targetMountId && resolvedMountRootPath) {
      return resolvedMountRootPath
    }

    return workspacePath
  }, [activeMenuSpace?.targetMountId, resolvedMountRootPath, workspacePath])

  const normalizedWorkspacePath = React.useMemo(
    () => normalizeComparablePath(workspaceRootForComparison),
    [workspaceRootForComparison],
  )

  const activeMenuSpacePath = React.useMemo(() => {
    if (!activeMenuSpace) {
      return workspaceRootForComparison
    }

    const trimmed = activeMenuSpace.directoryPath.trim()
    return trimmed.length > 0 ? trimmed : workspaceRootForComparison
  }, [activeMenuSpace, workspaceRootForComparison])

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
