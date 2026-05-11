import { useCallback, useEffect, useRef } from 'react'
import { getViewportForBounds, useStore, type Node, type ReactFlowInstance } from '@xyflow/react'
import type { FocusNodeTargetZoom } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { computeSpaceRectFromNodes } from '../../../utils/spaceLayout'
import { resolveWorkspaceCanvasAnimationDuration } from '../helpers'

const DEFAULT_VIEWPORT_WIDTH = 1440
const DEFAULT_VIEWPORT_HEIGHT = 900

export function useWorkspaceCanvasSpaceFocus({
  workspaceId,
  activeSpaceId,
  onActiveSpaceChange,
  focusNodeTargetZoom,
  reactFlow,
  nodesRef,
  spacesRef,
  cancelSpaceRename,
}: {
  workspaceId: string
  activeSpaceId: string | null
  onActiveSpaceChange: (spaceId: string | null) => void
  focusNodeTargetZoom: FocusNodeTargetZoom
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  cancelSpaceRename: () => void
}): {
  activateSpace: (spaceId: string) => void
  activateAllSpaces: () => void
  setActiveSpaceIdFromNodeNavigation: (spaceId: string | null) => void
  focusSpaceInViewport: (spaceId: string) => boolean
  focusAllInViewport: () => void
} {
  const lastAppliedWorkspaceIdRef = useRef<string | null>(null)
  const lastAppliedActiveSpaceIdRef = useRef<string | null | undefined>(undefined)
  const skipNextActiveSpaceViewportFocusRef = useRef(false)
  const viewportWidth = useStore(state => state.width)
  const viewportHeight = useStore(state => state.height)
  const viewportMinZoom = useStore(state => state.minZoom)
  const viewportMaxZoom = useStore(state => state.maxZoom)

  const focusSpaceInViewport = useCallback(
    (spaceId: string): boolean => {
      const space = spacesRef.current.find(item => item.id === spaceId) ?? null
      if (!space) {
        return false
      }

      const rect =
        space.rect ??
        (() => {
          const nodeById = new Map(nodesRef.current.map(node => [node.id, node]))
          const ownedNodes = space.nodeIds
            .map(nodeId => nodeById.get(nodeId))
            .filter((node): node is Node<TerminalNodeData> => Boolean(node))

          if (ownedNodes.length === 0) {
            return null
          }

          return computeSpaceRectFromNodes(
            ownedNodes.map(node => ({
              x: node.position.x,
              y: node.position.y,
              width: node.data.width,
              height: node.data.height,
            })),
          )
        })()

      if (!rect) {
        return false
      }

      const width = viewportWidth > 0 ? viewportWidth : DEFAULT_VIEWPORT_WIDTH
      const height = viewportHeight > 0 ? viewportHeight : DEFAULT_VIEWPORT_HEIGHT
      const maxZoom = Math.max(viewportMinZoom, Math.min(viewportMaxZoom, focusNodeTargetZoom))
      const nextViewport = getViewportForBounds(rect, width, height, viewportMinZoom, maxZoom, 0.16)

      void reactFlow.setViewport(nextViewport, {
        duration: resolveWorkspaceCanvasAnimationDuration(220),
      })
      return true
    },
    [
      focusNodeTargetZoom,
      nodesRef,
      reactFlow,
      spacesRef,
      viewportHeight,
      viewportMaxZoom,
      viewportMinZoom,
      viewportWidth,
    ],
  )

  const focusAllInViewport = useCallback((): void => {
    if (nodesRef.current.length === 0) {
      return
    }

    void reactFlow.fitView({
      padding: 0.16,
      duration: resolveWorkspaceCanvasAnimationDuration(220),
    })
  }, [nodesRef, reactFlow])

  const activateSpace = useCallback(
    (spaceId: string): void => {
      const targetSpace = spacesRef.current.find(space => space.id === spaceId) ?? null
      if (!targetSpace || targetSpace.parentSpaceId) {
        return
      }

      cancelSpaceRename()
      if (activeSpaceId === spaceId) {
        focusSpaceInViewport(spaceId)
        return
      }

      onActiveSpaceChange(spaceId)
    },
    [activeSpaceId, cancelSpaceRename, focusSpaceInViewport, onActiveSpaceChange, spacesRef],
  )

  const activateAllSpaces = useCallback((): void => {
    cancelSpaceRename()
    if (activeSpaceId === null) {
      focusAllInViewport()
      return
    }

    onActiveSpaceChange(null)
  }, [activeSpaceId, cancelSpaceRename, focusAllInViewport, onActiveSpaceChange])

  const setActiveSpaceIdFromNodeNavigation = useCallback(
    (spaceId: string | null): void => {
      const targetSpace = spaceId
        ? (spacesRef.current.find(space => space.id === spaceId) ?? null)
        : null
      const nextSpaceId = targetSpace && !targetSpace.parentSpaceId ? targetSpace.id : null
      if (activeSpaceId === nextSpaceId) {
        return
      }

      skipNextActiveSpaceViewportFocusRef.current = true
      onActiveSpaceChange(nextSpaceId)
    },
    [activeSpaceId, onActiveSpaceChange, spacesRef],
  )

  useEffect(() => {
    if (lastAppliedWorkspaceIdRef.current !== workspaceId) {
      lastAppliedWorkspaceIdRef.current = workspaceId
      lastAppliedActiveSpaceIdRef.current = undefined
    }

    const previousActiveSpaceId = lastAppliedActiveSpaceIdRef.current

    if (previousActiveSpaceId === undefined) {
      lastAppliedActiveSpaceIdRef.current = activeSpaceId
      return
    }

    if (previousActiveSpaceId === activeSpaceId) {
      return
    }

    lastAppliedActiveSpaceIdRef.current = activeSpaceId

    if (skipNextActiveSpaceViewportFocusRef.current) {
      skipNextActiveSpaceViewportFocusRef.current = false
      return
    }

    if (activeSpaceId) {
      focusSpaceInViewport(activeSpaceId)
      return
    }

    if (
      previousActiveSpaceId &&
      !spacesRef.current.some(space => space.id === previousActiveSpaceId)
    ) {
      return
    }

    focusAllInViewport()
  }, [activeSpaceId, focusAllInViewport, focusSpaceInViewport, spacesRef, workspaceId])

  return {
    activateSpace,
    activateAllSpaces,
    setActiveSpaceIdFromNodeNavigation,
    focusSpaceInViewport,
    focusAllInViewport,
  }
}
