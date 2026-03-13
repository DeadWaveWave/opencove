import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import type { NodeDeleteConfirmationState } from '../types'

interface UseNodeDeleteConfirmationParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  closeNode: (nodeId: string) => Promise<void>
  requestNodeDeleteRef: MutableRefObject<(nodeIds: string[]) => void>
}

function uniqNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds)]
}

export function useWorkspaceCanvasNodeDeleteConfirmation({
  nodesRef,
  closeNode,
  requestNodeDeleteRef,
}: UseNodeDeleteConfirmationParams): {
  nodeDeleteConfirmation: NodeDeleteConfirmationState | null
  setNodeDeleteConfirmation: React.Dispatch<
    React.SetStateAction<NodeDeleteConfirmationState | null>
  >
  confirmNodeDelete: () => Promise<void>
} {
  const [nodeDeleteConfirmation, setNodeDeleteConfirmation] =
    useState<NodeDeleteConfirmationState | null>(null)

  const requestNodeDelete = useCallback(
    (nodeIds: string[]) => {
      const normalizedNodeIds = uniqNodeIds(nodeIds).filter(nodeId =>
        nodesRef.current.some(node => node.id === nodeId),
      )
      if (normalizedNodeIds.length === 0) {
        return
      }

      const primaryNode = nodesRef.current.find(node => node.id === normalizedNodeIds[0])
      if (!primaryNode) {
        return
      }

      setNodeDeleteConfirmation({
        nodeIds: normalizedNodeIds,
        primaryNodeKind: primaryNode.data.kind,
        primaryNodeTitle: primaryNode.data.title,
      })
    },
    [nodesRef],
  )

  const confirmNodeDelete = useCallback(async () => {
    if (!nodeDeleteConfirmation) {
      return
    }

    await nodeDeleteConfirmation.nodeIds.reduce<Promise<void>>(
      (promise, nodeId) => promise.then(() => closeNode(nodeId)),
      Promise.resolve(),
    )

    setNodeDeleteConfirmation(null)
  }, [closeNode, nodeDeleteConfirmation])

  useEffect(() => {
    requestNodeDeleteRef.current = nodeIds => {
      requestNodeDelete(nodeIds)
    }
  }, [requestNodeDelete, requestNodeDeleteRef])

  return {
    nodeDeleteConfirmation,
    setNodeDeleteConfirmation,
    confirmNodeDelete,
  }
}
