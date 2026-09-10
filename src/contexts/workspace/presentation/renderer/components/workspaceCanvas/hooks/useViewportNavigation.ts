import { useEffect, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
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
  spaces,
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
  spaces: WorkspaceSpaceState[]
  focusSpaceInViewport: (spaceId: string) => boolean
  focusNodeTargetZoom: number
}): void {
  const focusedNodeRequestKeyRef = useRef<string | null>(null)
  const focusedSpaceRequestKeyRef = useRef<string | null>(null)
  const cancelInputFocusRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cancelInputFocusRef.current?.(), [workspaceId])

  useEffect(() => {
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
        const target = nodesRef.current.find(node => node.id === focusNodeId)
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

    if (!isWorkspaceViewportPending) {
      applyViewportIntent()
      return
    }

    // Initial restoration and explicit navigation are mutually exclusive viewport intents.
    // Waiting one frame lets React Flow initialize, while cleanup ensures the newest intent wins.
    const frame = window.requestAnimationFrame(applyViewportIntent)
    return () => {
      window.cancelAnimationFrame(frame)
    }
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
    spaces,
    workspaceId,
  ])
}
