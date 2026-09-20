import { useLayoutEffect, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { focusNodeInViewport } from '../helpers'
import { requestViewportNodeInputFocus } from '../requestViewportNodeInputFocus'

export function useWorkspaceCanvasViewportNavigation({
  workspaceId,
  persistedViewport,
  restoredViewportWorkspaceIdRef,
  reactFlow,
  focusNodeId,
  focusNodeInput,
  focusSpaceId,
  focusSequence,
  nodes,
  nodesRef,
  expandNode,
  focusSpaceInViewport,
  focusNodeTargetZoom,
}: {
  workspaceId: string
  persistedViewport: Viewport
  restoredViewportWorkspaceIdRef: React.MutableRefObject<string | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  focusNodeId?: string | null
  focusNodeInput?: boolean
  focusSpaceId?: string | null
  focusSequence?: number
  nodes: Node<TerminalNodeData>[]
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  expandNode: (id: string) => Node<TerminalNodeData> | undefined
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
  const cancelInputFocusRef = useRef<(() => void) | null>(null)

  // Cancel the previous workspace before layout navigation installs its next input request.
  useLayoutEffect(() => () => cancelInputFocusRef.current?.(), [workspaceId])

  useLayoutEffect(() => {
    if (!reactFlow.viewportInitialized) {
      return
    }

    const isWorkspaceViewportPending = restoredViewportWorkspaceIdRef.current !== workspaceId
    const sequence = focusSequence ?? 0
    const nodeRequestKey = focusNodeId ? `${workspaceId}:node:${focusNodeId}:${sequence}` : null
    const spaceRequestKey = focusSpaceId ? `${workspaceId}:space:${focusSpaceId}:${sequence}` : null
    if (!nodeRequestKey) {
      focusedNodeRequestKeyRef.current = null
    }
    if (!spaceRequestKey) {
      focusedSpaceRequestKeyRef.current = null
    }
    const hasPendingNodeRequest =
      nodeRequestKey !== null &&
      (isWorkspaceViewportPending || focusedNodeRequestKeyRef.current !== nodeRequestKey)
    const hasPendingSpaceRequest =
      spaceRequestKey !== null &&
      (isWorkspaceViewportPending || focusedSpaceRequestKeyRef.current !== spaceRequestKey)

    if (!isWorkspaceViewportPending && !hasPendingNodeRequest && !hasPendingSpaceRequest) {
      if (!nodeRequestKey || focusNodeInput !== true) {
        cancelInputFocusRef.current?.()
      }
      return
    }

    cancelInputFocusRef.current?.()

    const applyViewportIntent = (): void => {
      restoredViewportWorkspaceIdRef.current = workspaceId

      if (hasPendingNodeRequest && nodeRequestKey && focusNodeId) {
        const target = expandNode(focusNodeId)
        if (target) {
          focusedNodeRequestKeyRef.current = nodeRequestKey
          focusNodeInViewport(reactFlow, target, {
            duration: 220,
            zoom: focusNodeTargetZoom,
          })
          if (focusNodeInput === true) {
            cancelInputFocusRef.current = requestViewportNodeInputFocus(target.id)
          }
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
    focusNodeInput,
    focusNodeTargetZoom,
    focusSequence,
    focusSpaceId,
    focusSpaceInViewport,
    nodes,
    nodesRef,
    persistedViewport,
    reactFlow,
    restoredViewportWorkspaceIdRef,
    expandNode,
    workspaceId,
  ])
}
