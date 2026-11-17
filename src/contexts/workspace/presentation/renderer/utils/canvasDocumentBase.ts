import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'

function differsOutsideCanvasFields(
  documentNode: Node<TerminalNodeData>,
  canvasNode: Node<TerminalNodeData>,
  includeLivePositions: boolean,
): boolean {
  const keys = new Set([...Object.keys(documentNode), ...Object.keys(canvasNode)])
  for (const key of keys) {
    if (
      key === 'selected' ||
      key === 'dragHandle' ||
      (key === 'position' && includeLivePositions)
    ) {
      continue
    }
    const left = (documentNode as unknown as Record<string, unknown>)[key]
    const right = (canvasNode as unknown as Record<string, unknown>)[key]
    if (left !== right) {
      return true
    }
  }
  return false
}

/**
 * The store's nodes plus the fields only the canvas owns: `selected` and `dragHandle` always, and
 * `position` while a gesture holds live positions. Updaters written against the canvas view keep
 * seeing those fields while they compute from the store's current nodes. Canvas nodes that are no
 * longer in the document are dropped. Returns `documentNodes` itself when nothing differs.
 */
export function resolveCanvasDocumentBase(
  documentNodes: Node<TerminalNodeData>[],
  canvasNodes: Node<TerminalNodeData>[],
  { includeLivePositions }: { includeLivePositions: boolean },
): Node<TerminalNodeData>[] {
  const canvasNodeById = new Map(canvasNodes.map(node => [node.id, node]))
  let hasChanged = false

  const resolved = documentNodes.map(documentNode => {
    const canvasNode = canvasNodeById.get(documentNode.id)
    if (!canvasNode || canvasNode === documentNode) {
      return documentNode
    }

    if (!differsOutsideCanvasFields(documentNode, canvasNode, includeLivePositions)) {
      hasChanged = true
      return canvasNode
    }

    const position = includeLivePositions ? canvasNode.position : documentNode.position
    if (
      documentNode.selected === canvasNode.selected &&
      documentNode.dragHandle === canvasNode.dragHandle &&
      position === documentNode.position
    ) {
      return documentNode
    }

    hasChanged = true
    return {
      ...documentNode,
      selected: canvasNode.selected,
      dragHandle: canvasNode.dragHandle,
      position,
    }
  })

  return hasChanged ? resolved : documentNodes
}
