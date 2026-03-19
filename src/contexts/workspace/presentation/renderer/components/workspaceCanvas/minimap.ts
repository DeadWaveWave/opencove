import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../types'

export function resolveWorkspaceMinimapNodeColor(node: Node<TerminalNodeData>): string {
  switch (node.data.kind) {
    case 'agent':
      return 'var(--cove-canvas-minimap-node-agent)'
    case 'task':
      return 'var(--cove-canvas-minimap-node-task)'
    default:
      return 'var(--cove-canvas-minimap-node-default)'
  }
}
