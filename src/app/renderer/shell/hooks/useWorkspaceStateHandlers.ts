import { useCallback } from 'react'
import type {
  WorkspaceViewport,
  WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { sanitizeWorkspaceSpaces } from '@contexts/workspace/presentation/renderer/utils/workspaceSpaces'
import { useAppStore } from '../store/useAppStore'

export function useWorkspaceStateHandlers({
  requestPersistFlush,
}: {
  requestPersistFlush: () => void
}): {
  handleWorkspaceNodesChange: (nodes: WorkspaceState['nodes']) => void
  handleWorkspaceViewportChange: (viewport: WorkspaceViewport) => void
  handleWorkspaceMinimapVisibilityChange: (isVisible: boolean) => void
  handleWorkspaceSpacesChange: (spaces: WorkspaceState['spaces']) => void
  handleWorkspaceActiveSpaceChange: (spaceId: string | null) => void
  handleAnyWorkspaceWorktreesRootChange: (workspaceId: string, worktreesRoot: string) => void
} {
  const handleWorkspaceNodesChange = useCallback((nodes: WorkspaceState['nodes']): void => {
    const { activeWorkspaceId: currentActiveWorkspaceId, setWorkspaces: updateWorkspaces } =
      useAppStore.getState()
    if (!currentActiveWorkspaceId) {
      return
    }

    updateWorkspaces(prev =>
      prev.map(workspace => {
        if (workspace.id !== currentActiveWorkspaceId) {
          return workspace
        }

        const nodeIds = new Set(nodes.map(node => node.id))
        const nextSpaces = sanitizeWorkspaceSpaces(
          workspace.spaces.map(space => ({
            ...space,
            nodeIds: space.nodeIds.filter(nodeId => nodeIds.has(nodeId)),
          })),
        )
        const hasActiveSpace =
          workspace.activeSpaceId !== null &&
          nextSpaces.some(space => space.id === workspace.activeSpaceId)

        return {
          ...workspace,
          nodes,
          spaces: nextSpaces,
          activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
        }
      }),
    )
  }, [])

  const handleWorkspaceViewportChange = useCallback((viewport: WorkspaceViewport): void => {
    const { activeWorkspaceId: currentActiveWorkspaceId, setWorkspaces: updateWorkspaces } =
      useAppStore.getState()
    if (!currentActiveWorkspaceId) {
      return
    }

    updateWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== currentActiveWorkspaceId) {
          return workspace
        }

        if (
          workspace.viewport.x === viewport.x &&
          workspace.viewport.y === viewport.y &&
          workspace.viewport.zoom === viewport.zoom
        ) {
          return workspace
        }

        return {
          ...workspace,
          viewport: {
            x: viewport.x,
            y: viewport.y,
            zoom: viewport.zoom,
          },
        }
      }),
    )
  }, [])

  const handleWorkspaceMinimapVisibilityChange = useCallback((isVisible: boolean): void => {
    const { activeWorkspaceId: currentActiveWorkspaceId, setWorkspaces: updateWorkspaces } =
      useAppStore.getState()
    if (!currentActiveWorkspaceId) {
      return
    }

    updateWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== currentActiveWorkspaceId) {
          return workspace
        }

        if (workspace.isMinimapVisible === isVisible) {
          return workspace
        }

        return {
          ...workspace,
          isMinimapVisible: isVisible,
        }
      }),
    )
  }, [])

  const handleWorkspaceSpacesChange = useCallback((spaces: WorkspaceState['spaces']): void => {
    const { activeWorkspaceId: currentActiveWorkspaceId, setWorkspaces: updateWorkspaces } =
      useAppStore.getState()
    if (!currentActiveWorkspaceId) {
      return
    }

    updateWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== currentActiveWorkspaceId) {
          return workspace
        }

        const sanitizedSpaces = sanitizeWorkspaceSpaces(spaces)
        const hasActiveSpace =
          workspace.activeSpaceId !== null &&
          sanitizedSpaces.some(space => space.id === workspace.activeSpaceId)

        return {
          ...workspace,
          spaces: sanitizedSpaces,
          activeSpaceId: hasActiveSpace ? workspace.activeSpaceId : null,
        }
      }),
    )
  }, [])

  const handleWorkspaceActiveSpaceChange = useCallback((spaceId: string | null): void => {
    const { activeWorkspaceId: currentActiveWorkspaceId, setWorkspaces: updateWorkspaces } =
      useAppStore.getState()
    if (!currentActiveWorkspaceId) {
      return
    }

    updateWorkspaces(previous =>
      previous.map(workspace => {
        if (workspace.id !== currentActiveWorkspaceId) {
          return workspace
        }

        const hasTargetSpace =
          spaceId !== null && workspace.spaces.some(space => space.id === spaceId)
        const nextSpaceId = hasTargetSpace ? spaceId : null
        if (workspace.activeSpaceId === nextSpaceId) {
          return workspace
        }

        return {
          ...workspace,
          activeSpaceId: nextSpaceId,
        }
      }),
    )
  }, [])

  const handleAnyWorkspaceWorktreesRootChange = useCallback(
    (workspaceId: string, worktreesRoot: string): void => {
      const { setWorkspaces: updateWorkspaces } = useAppStore.getState()
      updateWorkspaces(previous =>
        previous.map(workspace => {
          if (workspace.id !== workspaceId) {
            return workspace
          }
          if (workspace.worktreesRoot === worktreesRoot) {
            return workspace
          }
          return {
            ...workspace,
            worktreesRoot,
          }
        }),
      )
      requestPersistFlush()
    },
    [requestPersistFlush],
  )

  return {
    handleWorkspaceNodesChange,
    handleWorkspaceViewportChange,
    handleWorkspaceMinimapVisibilityChange,
    handleWorkspaceSpacesChange,
    handleWorkspaceActiveSpaceChange,
    handleAnyWorkspaceWorktreesRootChange,
  }
}
