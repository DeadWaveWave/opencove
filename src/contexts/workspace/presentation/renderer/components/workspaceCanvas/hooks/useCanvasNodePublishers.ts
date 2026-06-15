import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'

export function useWorkspaceCanvasNodePublishers({
  setCanvasNodes,
  hasTransientNodePositionsRef,
  onNodesChange,
}: {
  setCanvasNodes: React.Dispatch<React.SetStateAction<Node<TerminalNodeData>[]>>
  hasTransientNodePositionsRef: MutableRefObject<boolean>
  onNodesChange: (nodes: Node<TerminalNodeData>[]) => void
}): {
  publishLiveNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  commitNodesChange: (nodes: Node<TerminalNodeData>[]) => void
} {
  const publishLiveNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      hasTransientNodePositionsRef.current = true
      setCanvasNodes(nextNodes)
    },
    [hasTransientNodePositionsRef, setCanvasNodes],
  )

  const commitNodesChange = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      hasTransientNodePositionsRef.current = false
      setCanvasNodes(nextNodes)
      onNodesChange(nextNodes)
    },
    [hasTransientNodePositionsRef, onNodesChange, setCanvasNodes],
  )

  return { publishLiveNodesChange, commitNodesChange }
}
