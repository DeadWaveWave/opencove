import { useCallback } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { decorateFlowNodes } from '../../../utils/canvasLiveNodes'
import { useReadCanvasSelection } from '../../../store/canvasStoreContext'
import { selectDragSurfaceSelectionMode } from '../../terminalNode/reactFlowState'

/**
 * The committed view of a canvas: nodes of the document with `selected` and `dragHandle` derived
 * from the selection slice and the drag surface mode of React Flow, read when the function runs.
 * It is the one derivation of the committed view that handlers use (the change path, which needs
 * what React Flow shows); `useWorkspaceCanvasState` renders the same function, so both get the same
 * view object for a node that did not change. The node writer does not use it: a recipe is given
 * the committed nodes, which hold no `selected` or `dragHandle` (S7). A gesture's live positions
 * are never part of it.
 */
export function useDecorateCommittedNodes(): (
  documentNodes: Node<TerminalNodeData>[],
) => Node<TerminalNodeData>[] {
  const readSelection = useReadCanvasSelection()
  const reactFlowStore = useStoreApi()

  return useCallback(
    documentNodes =>
      decorateFlowNodes(
        documentNodes,
        new Set(readSelection().nodeIds),
        selectDragSurfaceSelectionMode(reactFlowStore.getState()),
      ),
    [readSelection, reactFlowStore],
  )
}
