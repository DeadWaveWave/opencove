import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { useCanvasInteractionCommands } from '../../../store/canvasStoreContext'
import { replaceWorkspaceNodes } from '../../../store/workspaceDocumentCommands'

export function useWorkspaceCanvasNodePublishers({ workspaceId }: { workspaceId: string }): {
  publishLiveNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  commitNodesChange: (nodes: Node<TerminalNodeData>[]) => void
} {
  const { publishLiveNodes } = useCanvasInteractionCommands()

  // A drag frame reaches the overlay in the canvas store, not the document.
  const publishLiveNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => publishLiveNodes(nextNodes),
    [publishLiveNodes],
  )

  // The change path computes a batch from the stores when it runs and commits the whole array in
  // one write. A canvas write does not end the overlay (S6, PR 4); the release does, in the change
  // path, right after this write.
  const commitNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      replaceWorkspaceNodes(workspaceId, nextNodes)
    },
    [workspaceId],
  )

  return { publishLiveNodesChange, commitNodesChange }
}
