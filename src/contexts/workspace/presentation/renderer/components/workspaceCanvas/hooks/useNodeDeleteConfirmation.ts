import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { NodeDeleteConfirmationState } from '../types'

interface UseNodeDeleteConfirmationParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  closeNode: (nodeId: string) => Promise<void>
  requestNodeDeleteRef: MutableRefObject<(nodeIds: string[]) => void>
}

function uniqNodeIds(nodeIds: string[]): string[] {
  return [...new Set(nodeIds)]
}

function resolveNodeDeleteConfirmationState({
  nodeIds,
  nodes,
  spaces,
}: {
  nodeIds: string[]
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}): NodeDeleteConfirmationState | null {
  const normalizedNodeIds = uniqNodeIds(nodeIds).filter(nodeId =>
    nodes.some(node => node.id === nodeId),
  )
  if (normalizedNodeIds.length === 0) {
    return null
  }

  const primaryNode = nodes.find(node => node.id === normalizedNodeIds[0])
  if (!primaryNode) {
    return null
  }

  const nodeIdSet = new Set(nodes.map(node => node.id))
  const deletingNodeIdSet = new Set(normalizedNodeIds)
  const emptyingSpaces = spaces
    .filter(space => {
      const ownedNodeIds = space.nodeIds.filter(nodeId => nodeIdSet.has(nodeId))
      return (
        ownedNodeIds.length > 0 &&
        ownedNodeIds.some(nodeId => deletingNodeIdSet.has(nodeId)) &&
        ownedNodeIds.every(nodeId => deletingNodeIdSet.has(nodeId))
      )
    })
    .map(space => ({
      id: space.id,
      name: space.name,
    }))

  return {
    nodeIds: normalizedNodeIds,
    primaryNodeKind: primaryNode.data.kind,
    primaryNodeTitle: primaryNode.data.title,
    emptyingSpaces,
  }
}

export function useWorkspaceCanvasNodeDeleteConfirmation({
  nodesRef,
  spacesRef,
  closeNode,
  requestNodeDeleteRef,
}: UseNodeDeleteConfirmationParams): {
  nodeDeleteConfirmation: NodeDeleteConfirmationState | null
  setNodeDeleteConfirmation: React.Dispatch<
    React.SetStateAction<NodeDeleteConfirmationState | null>
  >
  confirmNodeDelete: () => Promise<void>
  requestNodeClose: (nodeId: string) => Promise<void>
} {
  const [nodeDeleteConfirmation, setNodeDeleteConfirmation] =
    useState<NodeDeleteConfirmationState | null>(null)

  const requestNodeDelete = useCallback(
    (nodeIds: string[]) => {
      const nextConfirmation = resolveNodeDeleteConfirmationState({
        nodeIds,
        nodes: nodesRef.current,
        spaces: spacesRef.current,
      })
      if (!nextConfirmation) {
        return
      }

      setNodeDeleteConfirmation(nextConfirmation)
    },
    [nodesRef, spacesRef],
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

  const requestNodeClose = useCallback(
    async (nodeId: string) => {
      const nextConfirmation = resolveNodeDeleteConfirmationState({
        nodeIds: [nodeId],
        nodes: nodesRef.current,
        spaces: spacesRef.current,
      })
      if (!nextConfirmation) {
        return
      }

      await closeNode(nodeId)
    },
    [closeNode, nodesRef, spacesRef],
  )

  useEffect(() => {
    requestNodeDeleteRef.current = nodeIds => {
      requestNodeDelete(nodeIds)
    }
  }, [requestNodeDelete, requestNodeDeleteRef])

  return {
    nodeDeleteConfirmation,
    setNodeDeleteConfirmation,
    confirmNodeDelete,
    requestNodeClose,
  }
}
