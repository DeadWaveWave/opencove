import { createAppError } from '../../../../shared/errors/appError'
import type { NodeControlNode, NodeControlWorkspace } from './nodeControlState'

function taskRecord(node: NodeControlNode): Record<string, unknown> {
  return node.task && typeof node.task === 'object' ? (node.task as Record<string, unknown>) : {}
}

/**
 * Validates that an agent can be launched for a task. Pure: throws before any launch or write.
 * A link to an agent that no longer exists is stale and does not block a new link.
 */
export function assertTaskCanTakeAgent(options: {
  workspace: NodeControlWorkspace
  spaceNodeIds: readonly string[] | null
  taskNodeId: string
}): void {
  const task = options.workspace.nodes.find(node => node.id === options.taskNodeId)
  if (!task) {
    throw createAppError('node.not_found', {
      debugMessage: `node.create agent taskNodeId ${options.taskNodeId} was not found in the target project.`,
    })
  }
  if (task.kind !== 'task') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create agent taskNodeId must reference a task node.',
    })
  }
  if (options.spaceNodeIds && !options.spaceNodeIds.includes(task.id)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create agent taskNodeId must be in the target Space.',
    })
  }
  const linkedAgentNodeId = taskRecord(task).linkedAgentNodeId
  if (
    typeof linkedAgentNodeId === 'string' &&
    options.workspace.nodes.some(node => node.id === linkedAgentNodeId && node.kind === 'agent')
  ) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'node.create agent taskNodeId already has a linked agent.',
    })
  }
}

/** Writes both sides of the task-agent link. Callers must validate first. */
export function linkAgentToTask(
  workspace: NodeControlWorkspace,
  options: { taskNodeId: string; agentNodeId: string; now: string },
): NodeControlWorkspace {
  return {
    ...workspace,
    nodes: workspace.nodes.map(node => {
      if (node.id !== options.taskNodeId) {
        return node
      }
      return {
        ...node,
        task: {
          ...taskRecord(node),
          status: 'doing',
          linkedAgentNodeId: options.agentNodeId,
          lastRunAt: options.now,
          updatedAt: options.now,
        },
      }
    }),
  }
}
