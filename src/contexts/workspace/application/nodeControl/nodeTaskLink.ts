import { createAppError } from '../../../../shared/errors/appError'
import type { NodeControlNode, NodeControlWorkspace } from './nodeControlState'

function taskRecord(node: NodeControlNode): Record<string, unknown> {
  return node.task && typeof node.task === 'object' ? (node.task as Record<string, unknown>) : {}
}

/** Validate before launch and again against every fresh creation commit snapshot. */
export function assertTaskCanTakeAgent({
  workspace,
  spaceId,
  taskNodeId,
}: {
  workspace: NodeControlWorkspace
  spaceId: string | null
  taskNodeId: string
}): void {
  const task = workspace.nodes.find(node => node.id === taskNodeId)
  if (!task) {
    throw createAppError('node.not_found', {
      debugMessage: `node.create agent taskNodeId ${taskNodeId} was not found in the target project.`,
    })
  }
  if (task.kind !== 'task') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create agent taskNodeId must reference a task node.',
    })
  }
  const taskSpaceId = workspace.spaces.find(space => space.nodeIds.includes(task.id))?.id ?? null
  if (taskSpaceId !== spaceId) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create agent taskNodeId must be in the target Space.',
    })
  }
  const linkedAgentNodeId = taskRecord(task).linkedAgentNodeId
  if (workspace.nodes.some(node => node.id === linkedAgentNodeId && node.kind === 'agent')) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create agent taskNodeId already has a linked agent.',
    })
  }
}

/** Pure task transition; persisted together with the new agent, never as a separate write. */
export function linkAgentToTask(
  workspace: NodeControlWorkspace,
  options: { taskNodeId: string; agentNodeId: string; now: string },
): NodeControlWorkspace {
  return {
    ...workspace,
    nodes: workspace.nodes.map(node =>
      node.id !== options.taskNodeId
        ? node
        : {
            ...node,
            task: {
              ...taskRecord(node),
              status: 'doing',
              linkedAgentNodeId: options.agentNodeId,
              lastRunAt: options.now,
              updatedAt: options.now,
            },
          },
    ),
  }
}
