import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { ensureNodesHaveInitialDimensions } from '../../../utils/reactFlowNodeDimensions'
import { commitCanvasDocument, isActiveWorkspace } from '../../../store/workspaceDocumentCommands'
import { useCanvasWorkspaceId } from '../../../store/canvasStoreContext'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../terminalNode/constants'
import { syncWorkspaceCanvasTestStateInTestWindow } from '../testHarness'
import type { CanvasDocumentRecipeInput, CanvasDocumentWriteOptions } from './useNodesStore.types'
import { useDecorateCommittedNodes } from './useDecorateCommittedNodes'

export interface CanvasNodeWriter {
  updateNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: CanvasDocumentWriteOptions,
  ) => void
  /**
   * Writes nodes and Spaces in one store update, computed from the store's document as it is when
   * this runs. The recipe must be pure: it runs under the document module's recipe guard.
   */
  updateCanvasDocument: (
    recipe: (document: CanvasDocumentRecipeInput) => CanvasDocumentRecipeInput,
    options?: CanvasDocumentWriteOptions,
  ) => void
}

/**
 * The canvas's writer of nodes (S6, PR 4). It needs nothing from `WorkspaceCanvasInner`: the
 * workspace is the provider's, and the base of a recipe is the committed view, computed when the
 * recipe runs, from the store's nodes and the selection. It never reads a gesture's live positions:
 * a write during a gesture commits the committed ones, and the gesture's windows reach the document
 * at the release. It writes the workspace of the render that made it, also after the user has
 * switched away; the layout-sync event and the test state follow only while that workspace is
 * shown.
 */
export function useCanvasNodeWriter(): CanvasNodeWriter {
  const workspaceId = useCanvasWorkspaceId()
  const decorateCommittedNodes = useDecorateCommittedNodes()

  const updateCanvasDocument = useCallback<CanvasNodeWriter['updateCanvasDocument']>(
    (recipe, options = {}) => {
      let previousDocumentNodes: Node<TerminalNodeData>[] | null = null
      const result = commitCanvasDocument(
        workspaceId,
        document => {
          previousDocumentNodes = document.nodes
          const base = decorateCommittedNodes(document.nodes)
          const output = recipe({ nodes: base, spaces: document.spaces })
          const nextNodes = ensureNodesHaveInitialDimensions(output.nodes)
          // `selected` and `dragHandle` are canvas-only fields: a recipe that changes nothing
          // else is not a change.
          if (nextNodes === base && output.spaces === document.spaces) {
            return document
          }
          return {
            ...document,
            nodes: nextNodes === base ? document.nodes : nextNodes,
            spaces: output.spaces,
          }
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
    [decorateCommittedNodes, workspaceId],
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
