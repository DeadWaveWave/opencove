import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'

export function setAgentNodeFailureInNodes({
  nodeId,
  message,
  setNodes,
}: {
  nodeId: string
  message: string
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
}): void {
  setNodes(
    prevNodes =>
      prevNodes.map(item => {
        if (item.id !== nodeId) {
          return item
        }

        return {
          ...item,
          data: {
            ...item.data,
            status: 'failed',
            endedAt: new Date().toISOString(),
            lastError: message,
          },
        }
      }),
    { syncLayout: false },
  )
}
