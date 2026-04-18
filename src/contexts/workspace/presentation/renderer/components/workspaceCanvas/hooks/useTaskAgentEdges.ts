import { useMemo } from 'react'
import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { isAgentWorking } from '../helpers'

export function useWorkspaceCanvasTaskAgentEdges(nodes: Node<TerminalNodeData>[]): Edge[] {
  return useMemo(() => {
    const nodeById = new Map(nodes.map(node => [node.id, node]))

    return nodes
      .filter(node => node.data.kind === 'task' && node.data.task?.linkedAgentNodeId)
      .flatMap(taskNode => {
        const linkedAgentNodeId = taskNode.data.task?.linkedAgentNodeId
        if (!linkedAgentNodeId) {
          return []
        }

        const linkedAgentNode = nodeById.get(linkedAgentNodeId)
        if (!linkedAgentNode || linkedAgentNode.data.kind !== 'agent') {
          return []
        }

        const isActive = isAgentWorking(linkedAgentNode.data.status)
        const edgeClassName = isActive
          ? 'workspace-task-agent-edge workspace-task-agent-edge--active'
          : 'workspace-task-agent-edge workspace-task-agent-edge--idle'
        const markerColor = isActive ? 'rgba(121, 197, 255, 0.95)' : 'rgba(130, 168, 214, 0.78)'

        return [
          {
            id: `task-link-${taskNode.id}-${linkedAgentNode.id}`,
            source: taskNode.id,
            target: linkedAgentNode.id,
            type: 'default',
            animated: isActive,
            className: edgeClassName,
            selectable: false,
            focusable: false,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: markerColor,
              width: 22,
              height: 22,
            },
          },
        ]
      })
  }, [nodes])
}
