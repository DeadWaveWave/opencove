import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import {
  useCanvasInteractionCommands,
  useReadCanvasInteraction,
} from '../../../store/canvasStoreContext'
import { replaceWorkspaceNodes } from '../../../store/workspaceDocumentCommands'

export function useWorkspaceCanvasNodePublishers({ workspaceId }: { workspaceId: string }): {
  publishLiveNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  commitNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  publishCommittedNodes: () => void
  isLiveGestureActive: () => boolean
} {
  const { publishLiveNodes, endLiveNodes } = useCanvasInteractionCommands()
  const readInteraction = useReadCanvasInteraction()

  // A drag frame reaches the overlay in the canvas store, not the document.
  const publishLiveNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => publishLiveNodes(nextNodes),
    [publishLiveNodes],
  )

  // The canvas-side half of a commit, for writers that already stored the nodes: the gesture is
  // over, so its overlay goes.
  const publishCommittedNodes = useCallback(() => endLiveNodes(), [endLiveNodes])

  // React Flow's change path computes from the node store's mirror of the canvas view and commits the
  // whole array. The document is written first and the overlay cleared after it, in one block: a
  // render between the two shows the overlay over the new nodes, never the nodes before the drag.
  const commitNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      replaceWorkspaceNodes(workspaceId, nextNodes)
      endLiveNodes()
    },
    [endLiveNodes, workspaceId],
  )

  const isLiveGestureActive = useCallback(
    () => readInteraction().liveNodes !== null,
    [readInteraction],
  )

  return { publishLiveNodesChange, commitNodesChange, publishCommittedNodes, isLiveGestureActive }
}
