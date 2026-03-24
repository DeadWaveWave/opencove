import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'

export function resolveSpaceTasks(
  space: WorkspaceSpaceState | null,
  nodes: Node<TerminalNodeData>[],
): { title: string; requirement: string }[] {
  if (!space) {
    return []
  }

  const spaceNodeIds = new Set(space.nodeIds)

  return nodes
    .filter(node => spaceNodeIds.has(node.id) && node.data.kind === 'task' && node.data.task)
    .map(node => ({
      title: node.data.title,
      requirement: node.data.task?.requirement ?? '',
    }))
}
