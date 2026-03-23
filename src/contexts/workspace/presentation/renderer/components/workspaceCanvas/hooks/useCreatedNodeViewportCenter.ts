import { useCallback, useLayoutEffect, useState, type MutableRefObject } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceViewport } from '../../../types'
import { centerNodeInViewport } from '../helpers'

export function useWorkspaceCanvasCreatedNodeViewportCenter(
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>,
  nodesRefRef: MutableRefObject<MutableRefObject<Array<Node<TerminalNodeData>>> | null>,
  viewportRef: MutableRefObject<WorkspaceViewport>,
): (nodeId: string) => void {
  const [createdNodeId, setCreatedNodeId] = useState<string | null>(null)

  const handleNodeCreated = useCallback((nodeId: string) => {
    const normalizedNodeId = nodeId.trim()
    if (normalizedNodeId.length === 0) {
      return
    }

    setCreatedNodeId(normalizedNodeId)
  }, [])

  useLayoutEffect(() => {
    if (!createdNodeId) {
      return
    }

    const nodes = nodesRefRef.current?.current ?? []
    const targetNode =
      reactFlow.getNode?.(createdNodeId) ?? nodes.find(node => node.id === createdNodeId) ?? null
    if (!targetNode) {
      return
    }

    centerNodeInViewport(reactFlow, targetNode, {
      duration: 180,
      zoom: viewportRef.current.zoom,
    })
  }, [createdNodeId, nodesRefRef, reactFlow, viewportRef])

  return handleNodeCreated
}
