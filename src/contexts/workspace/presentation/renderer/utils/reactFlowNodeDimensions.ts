import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../types'

export function ensureNodesHaveInitialDimensions(
  nodes: Node<TerminalNodeData>[],
): Node<TerminalNodeData>[] {
  let hasChanged = false

  const nextNodes = nodes.map(node => {
    const width = node.data.width
    const height = node.data.height

    if (node.initialWidth === width && node.initialHeight === height) {
      return node
    }

    hasChanged = true
    return {
      ...node,
      initialWidth: width,
      initialHeight: height,
    }
  })

  return hasChanged ? nextNodes : nodes
}
