import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { replaceWorkspaceNodes } from '../../../store/workspaceDocumentCommands'
import type { LiveCanvasStore } from './useCanvasState'

export function useWorkspaceCanvasNodePublishers({
  workspaceId,
  liveStore,
  setCanvasNodes,
  hasTransientNodePositionsRef,
}: {
  workspaceId: string
  liveStore: LiveCanvasStore
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
      liveStore.setState(state => ({ ...state, liveNodes: nextNodes }))
    },
    [hasTransientNodePositionsRef, liveStore],
  )

  // The canvas-side half of a commit, for writers that already stored the nodes.
  const publishCommittedNodes = useCallback(
    (nextNodes: Node<TerminalNodeData>[]) => {
      hasTransientNodePositionsRef.current = false
      liveStore.setState(state =>
        state.liveNodes === null ? state : { ...state, liveNodes: null },
      )
      setCanvasNodes(nextNodes)
    },
    [hasTransientNodePositionsRef, liveStore, setCanvasNodes],
  )

  // React Flow's change path computes from the node store's mirror of the canvas view and commits the
  // whole array.
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
