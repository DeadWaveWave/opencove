import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { NodeDeleteConfirmationState } from '../types'
import {
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

interface UseNodeDeleteConfirmationParams {
  closeNode: (nodeId: string) => Promise<void>
}

function uniqNodeIds(nodeIds: readonly string[]): string[] {
  return [...new Set(nodeIds)]
}

function resolveNodeDeleteConfirmationState({
  nodeIds,
  nodes,
  spaces,
}: {
  nodeIds: readonly string[]
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
  closeNode,
}: UseNodeDeleteConfirmationParams): {
  confirmNodeDelete: () => Promise<void>
  requestNodeClose: (nodeId: string) => Promise<void>
  requestNodeDelete: (nodeIds: readonly string[]) => void
} {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()
  const readDocument = useReadCanvasDocument()

  // The nodes and the Spaces are read when a request is made, not subscribed to: the list is the
  // one the user sees at the moment they ask.
  const requestNodeDelete = useCallback(
    (nodeIds: readonly string[]) => {
      const { nodes, spaces } = readDocument()
      const nextConfirmation = resolveNodeDeleteConfirmationState({ nodeIds, nodes, spaces })
      if (!nextConfirmation) {
        return
      }

      ui.openDialog('nodeDeleteConfirmation', nextConfirmation)
    },
    [readDocument, ui],
  )

  const confirmNodeDelete = useCallback(async () => {
    const nodeDeleteConfirmation = readUi().nodeDeleteConfirmation
    if (!nodeDeleteConfirmation) {
      return
    }

    await nodeDeleteConfirmation.nodeIds.reduce<Promise<void>>(
      (promise, nodeId) => promise.then(() => closeNode(nodeId)),
      Promise.resolve(),
    )

    ui.closeDialog('nodeDeleteConfirmation')
  }, [closeNode, readUi, ui])

  const requestNodeClose = useCallback(
    async (nodeId: string) => {
      const { nodes, spaces } = readDocument()
      const nextConfirmation = resolveNodeDeleteConfirmationState({
        nodeIds: [nodeId],
        nodes,
        spaces,
      })
      if (!nextConfirmation) {
        return
      }

      await closeNode(nodeId)
    },
    [closeNode, readDocument],
  )

  return {
    confirmNodeDelete,
    requestNodeClose,
    requestNodeDelete,
  }
}
