import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '@contexts/workspace/presentation/renderer/types'
import { resolveAgentNodeMinSize } from '@contexts/workspace/presentation/renderer/utils/workspaceNodeSizing'

export function repairRuntimeNodeFrame(node: Node<TerminalNodeData>): Node<TerminalNodeData> {
  if (node.data.kind !== 'agent') {
    return node
  }

  const minSize = resolveAgentNodeMinSize(node.data.agent?.provider)
  const width = Math.max(node.data.width, minSize.width)
  const height = Math.max(node.data.height, minSize.height)

  if (width === node.data.width && height === node.data.height) {
    return node
  }

  return {
    ...node,
    initialWidth: Math.max(node.initialWidth ?? width, width),
    initialHeight: Math.max(node.initialHeight ?? height, height),
    width: typeof node.width === 'number' ? Math.max(node.width, width) : node.width,
    height: typeof node.height === 'number' ? Math.max(node.height, height) : node.height,
    data: {
      ...node.data,
      width,
      height,
    },
  }
}
