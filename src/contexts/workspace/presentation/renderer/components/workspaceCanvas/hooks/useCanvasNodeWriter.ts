import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { ensureNodesHaveInitialDimensions } from '../../../utils/reactFlowNodeDimensions'
import { commitCanvasDocument, isActiveWorkspace } from '../../../store/workspaceDocumentCommands'
import { useCanvasWorkspaceId } from '../../../store/canvasStoreContext'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../terminalNode/constants'
import { syncWorkspaceCanvasTestStateInTestWindow } from '../testHarness'
import type { CanvasDocumentWriteOptions, UpdateCanvasDocument } from './useNodesStore.types'

export interface CanvasNodeWriter {
  updateNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: CanvasDocumentWriteOptions,
  ) => void
  /** One store update of nodes and Spaces; see `UpdateCanvasDocument`. */
  updateCanvasDocument: UpdateCanvasDocument
}

/**
 * The canvas's writer of nodes (S6, PR 4). It needs nothing from `WorkspaceCanvasInner`: the
 * workspace is the provider's, and the base of a recipe is the committed nodes, the store's own
 * objects as they are when the recipe runs (S7, PR 3: the document holds no `selected` or
 * `dragHandle`, so the writer decorates nothing). It never reads a gesture's live positions:
 * a write during a gesture commits the committed ones, and the gesture's windows reach the document
 * at the release. It writes the workspace of the render that made it, also after the user has
 * switched away; the layout-sync event and the test state follow only while that workspace is
 * shown.
 */
export function useCanvasNodeWriter(): CanvasNodeWriter {
  const workspaceId = useCanvasWorkspaceId()

  const updateCanvasDocument = useCallback<CanvasNodeWriter['updateCanvasDocument']>(
    (recipe, options = {}) => {
      let previousDocumentNodes: Node<TerminalNodeData>[] | null = null
      const result = commitCanvasDocument(
        workspaceId,
        document => {
          previousDocumentNodes = document.nodes
          const output = recipe({ nodes: document.nodes, spaces: document.spaces })
          const nextNodes = ensureNodesHaveInitialDimensions(output.nodes)
          if (nextNodes === document.nodes && output.spaces === document.spaces) {
            return document
          }
          return { ...document, nodes: nextNodes, spaces: output.spaces }
        },
        { flush: options.flush },
      )

      if (
        result.status !== 'applied' ||
        result.document.nodes === previousDocumentNodes ||
        !isActiveWorkspace(workspaceId)
      ) {
        return
      }

      syncWorkspaceCanvasTestStateInTestWindow(result.document.nodes)

      if (options.syncLayout ?? true) {
        window.dispatchEvent(new Event(TERMINAL_LAYOUT_SYNC_EVENT))
      }
    },
    [workspaceId],
  )

  const updateNodes = useCallback<CanvasNodeWriter['updateNodes']>(
    (updater, options) => {
      updateCanvasDocument(
        ({ nodes: prevNodes, spaces }) => ({ nodes: updater(prevNodes), spaces }),
        options,
      )
    },
    [updateCanvasDocument],
  )

  return { updateNodes, updateCanvasDocument }
}
