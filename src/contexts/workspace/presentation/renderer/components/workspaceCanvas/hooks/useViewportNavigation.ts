import { useLayoutEffect, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { focusNodeInViewport } from '../helpers'

export function useWorkspaceCanvasViewportNavigation({
  workspaceId,
  persistedViewport,
  restoredViewportWorkspaceIdRef,
  reactFlow,
  focusNodeId,
  focusSpaceId,
  focusSequence,
  nodes,
  nodesRef,
  spaces,
  focusSpaceInViewport,
  focusNodeTargetZoom,
}: {
  workspaceId: string
  persistedViewport: Viewport
  restoredViewportWorkspaceIdRef: React.MutableRefObject<string | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  focusNodeId?: string | null
  focusSpaceId?: string | null
  focusSequence?: number
  nodes: Node<TerminalNodeData>[]
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spaces: WorkspaceSpaceState[]
  focusSpaceInViewport: (spaceId: string) => boolean
  focusNodeTargetZoom: number
}): void {
  // Stop the underlying D3 transition before this canvas's lifecycle is released.
  // Interrupted React Flow promises do not settle, so cleanup must be synchronous.
  useLayoutEffect(() => {
    return () => {
      void reactFlow.setViewport(reactFlow.getViewport(), { duration: 0 })
    }
  }, [reactFlow, workspaceId])

  const focusedNodeRequestKeyRef = useRef<string | null>(null)
  const focusedSpaceRequestKeyRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (!reactFlow.viewportInitialized) {
      return
    }

    const isWorkspaceViewportPending = restoredViewportWorkspaceIdRef.current !== workspaceId
    const sequence = focusSequence ?? 0
    const nodeRequestKey = focusNodeId ? `${workspaceId}:node:${focusNodeId}:${sequence}` : null
    const spaceRequestKey = focusSpaceId ? `${workspaceId}:space:${focusSpaceId}:${sequence}` : null
    const hasPendingNodeRequest =
      nodeRequestKey !== null &&
      (isWorkspaceViewportPending || focusedNodeRequestKeyRef.current !== nodeRequestKey)
    const hasPendingSpaceRequest =
      spaceRequestKey !== null &&
      (isWorkspaceViewportPending || focusedSpaceRequestKeyRef.current !== spaceRequestKey)

    if (!isWorkspaceViewportPending && !hasPendingNodeRequest && !hasPendingSpaceRequest) {
      return
    }

    const applyViewportIntent = (): void => {
      restoredViewportWorkspaceIdRef.current = workspaceId

      if (hasPendingNodeRequest && nodeRequestKey && focusNodeId) {
        const target = nodesRef.current.find(node => node.id === focusNodeId)
        if (target) {
          focusedNodeRequestKeyRef.current = nodeRequestKey
          focusNodeInViewport(reactFlow, target, {
            duration: 220,
            zoom: focusNodeTargetZoom,
          })
          return
        }
      }

      if (
        hasPendingSpaceRequest &&
        spaceRequestKey &&
        focusSpaceId &&
        focusSpaceInViewport(focusSpaceId)
      ) {
        focusedSpaceRequestKeyRef.current = spaceRequestKey
        return
      }

      if (isWorkspaceViewportPending) {
        void reactFlow.setViewport(persistedViewport, { duration: 0 })
      }
    }

    // Readiness is explicit: restore before passive creation focus, without a delayed
    // frame that could overwrite a newer navigation or user gesture.
    applyViewportIntent()
  }, [
    focusNodeId,
    focusNodeTargetZoom,
    focusSequence,
    focusSpaceId,
    focusSpaceInViewport,
    nodes,
    nodesRef,
    persistedViewport,
    reactFlow,
    restoredViewportWorkspaceIdRef,
    spaces,
    workspaceId,
  ])
}
