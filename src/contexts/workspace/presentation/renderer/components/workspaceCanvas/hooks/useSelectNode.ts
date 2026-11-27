import { useCallback } from 'react'
import { useStoreApi, type Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { isPointInsideRect } from './useSpaceOwnership.helpers'
import {
  useCanvasSelectionCommands,
  useReadCanvasDocument,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'

function resolveContainingSpaceId(
  node: Node<TerminalNodeData>,
  spaces: readonly WorkspaceSpaceState[],
): string | null {
  const center = {
    x: node.position.x + node.data.width / 2,
    y: node.position.y + node.data.height / 2,
  }

  for (const space of spaces) {
    if (!space.rect) {
      continue
    }

    if (isPointInsideRect(center, space.rect)) {
      return space.id
    }
  }

  return null
}

/**
 * The windows selected after a click on `nodeId`, in document order. Which windows are selected
 * now is the selection slice's (`selectedNodeIds`); the document's nodes only give the order and
 * the positions, and its Spaces the scope. Nothing here reads a flag of a document node.
 */
function resolveNextSelectedNodeIds({
  nodeId,
  toggle,
  nodes,
  spaces,
  selectedNodeIds,
}: {
  nodeId: string
  toggle: boolean
  nodes: readonly Node<TerminalNodeData>[]
  spaces: readonly WorkspaceSpaceState[]
  selectedNodeIds: ReadonlySet<string>
}): string[] {
  if (toggle) {
    const targetNode = nodes.find(node => node.id === nodeId) ?? null
    const targetScope = targetNode ? resolveContainingSpaceId(targetNode, spaces) : null
    const toggledSelectedIds: string[] = []

    for (const node of nodes) {
      const isInScope = resolveContainingSpaceId(node, spaces) === targetScope
      const wasSelected = selectedNodeIds.has(node.id)
      const isSelected = isInScope && (node.id === nodeId ? !wasSelected : wasSelected)

      if (isSelected) {
        toggledSelectedIds.push(node.id)
      }
    }

    return toggledSelectedIds
  }

  const isAlreadySelected = selectedNodeIds.has(nodeId) && nodes.some(node => node.id === nodeId)
  if (isAlreadySelected) {
    return nodes.filter(node => selectedNodeIds.has(node.id)).map(node => node.id)
  }

  return [nodeId]
}

/**
 * Selects a window, or toggles it within its Space scope. It writes the selection slice and React
 * Flow's two selection flags, and nothing else: the document does not carry the selection (S7,
 * PR 2). It computes from the slice and the document when it runs, and writes nothing for a
 * window the document no longer holds.
 */
export function useWorkspaceCanvasSelectNode(): (
  nodeId: string,
  options?: { toggle?: boolean },
) => void {
  const reactFlowStore = useStoreApi()
  const readDocument = useReadCanvasDocument()
  const readSelection = useReadCanvasSelection()
  const selection = useCanvasSelectionCommands()

  return useCallback(
    (nodeId: string, options?: { toggle?: boolean }) => {
      const shouldToggle = options?.toggle === true
      // `before` is the selection the click found, read before this call writes it.
      const before = readSelection()
      const { nodes, spaces } = readDocument()
      // Invariant 2 of S7: a window the document no longer holds writes nothing, so a late
      // callback of a closed window leaves no dangling id and keeps the selection of the others.
      if (!nodes.some(node => node.id === nodeId)) {
        return
      }
      const nextSelectedNodeIds = resolveNextSelectedNodeIds({
        nodeId,
        toggle: shouldToggle,
        nodes,
        spaces,
        selectedNodeIds: new Set(before.nodeIds),
      })

      const shouldClearSpaces =
        !shouldToggle &&
        nextSelectedNodeIds.includes(nodeId) &&
        nextSelectedNodeIds.length === 1 &&
        !(before.spaceIds.length > 0 && before.nodeIds.includes(nodeId))
      selection.select({
        nodeIds: nextSelectedNodeIds,
        spaceIds: shouldClearSpaces ? [] : before.spaceIds,
      })
      const hasAnySelection = nextSelectedNodeIds.length > 0 || readSelection().spaceIds.length > 0
      reactFlowStore.setState({
        nodesSelectionActive: nextSelectedNodeIds.length > 0,
        coveDragSurfaceSelectionMode: shouldToggle && hasAnySelection,
      } as unknown as Parameters<typeof reactFlowStore.setState>[0])
    },
    [reactFlowStore, readDocument, readSelection, selection],
  )
}
