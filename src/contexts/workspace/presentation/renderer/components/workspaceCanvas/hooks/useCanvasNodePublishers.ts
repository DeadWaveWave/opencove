import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { replaceWorkspaceNodes } from '../../../store/workspaceDocumentCommands'

export function useWorkspaceCanvasNodePublishers({
  workspaceId,
  setCanvasNodes,
  hasTransientNodePositionsRef,
}: {
  workspaceId: string
  setCanvasNodes: React.Dispatch<React.SetStateAction<Node<TerminalNodeData>[]>>
  hasTransientNodePositionsRef: MutableRefObject<boolean>
}): {
  publishLiveNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  commitNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  publishCommittedNodes: (nodes: Node<TerminalNodeData>[]) => void
  isLiveGestureActive: () => boolean
} {
  const publishLiveNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      hasTransientNodePositionsRef.current = true
      setCanvasNodes(nextNodes)
    },
    [hasTransientNodePositionsRef, setCanvasNodes],
  )

  // The canvas-side half of a commit, for writers that already stored the nodes.
  const publishCommittedNodes = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      hasTransientNodePositionsRef.current = false
      setCanvasNodes(nextNodes)
    },
    [hasTransientNodePositionsRef, setCanvasNodes],
  )

  // React Flow's change path computes from nodesRef and commits the whole array.
  const commitNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      publishCommittedNodes(nextNodes)
      replaceWorkspaceNodes(workspaceId, nextNodes)
    },
    [publishCommittedNodes, workspaceId],
  )

  const isLiveGestureActive = useCallback(
    () => hasTransientNodePositionsRef.current,
    [hasTransientNodePositionsRef],
  )

  return { publishLiveNodesChange, commitNodesChange, publishCommittedNodes, isLiveGestureActive }
}
