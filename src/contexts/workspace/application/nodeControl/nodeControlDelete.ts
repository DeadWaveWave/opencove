import type { DeleteNodeInput, DeleteNodeResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import {
  persistNodeControlState,
  replaceNodeControlWorkspace,
  requireNodeControlState,
  type NodeControlAppStateStore,
  type NodeControlNode,
  type NodeControlWorkspace,
} from './nodeControlState'
import { findNodeForNodeControl } from './nodeDtos'
import type { NodeControlRuntimeDeps } from './nodeControlUseCases'

export async function deleteNodeForNodeControl(options: {
  store: NodeControlAppStateStore
  runtime: Pick<NodeControlRuntimeDeps, 'killSession' | 'closeWebsiteNode'>
  input: DeleteNodeInput
  now: Date
}): Promise<DeleteNodeResult> {
  const state = requireNodeControlState(await options.store.readAppState())
  const matched = findNodeForNodeControl(state.workspaces, options.input.nodeId)
  if (!matched) {
    throw createAppError('node.not_found')
  }

  const nextWorkspace = removeNodeWithRelations(matched.workspace, matched.node, options.now)
  const revision = await persistNodeControlState(
    options.store,
    replaceNodeControlWorkspace(state, nextWorkspace),
  )
  const cleanup = { attempted: false, ok: true }

  if (matched.node.sessionId) {
    cleanup.attempted = true
    await Promise.resolve(options.runtime.killSession(matched.node.sessionId)).catch(() => {
      cleanup.ok = false
    })
  }

  if (matched.node.kind === 'website' && options.runtime.closeWebsiteNode) {
    cleanup.attempted = true
    await Promise.resolve(options.runtime.closeWebsiteNode(matched.node.id)).catch(() => {
      cleanup.ok = false
    })
  }

  return {
    revision,
    projectId: matched.workspace.id,
    spaceId: matched.spaceId,
    nodeId: matched.node.id,
    runtimeCleanup: cleanup,
  }
}

function removeNodeWithRelations(
  workspace: NodeControlWorkspace,
  target: NodeControlNode,
  now: Date,
): NodeControlWorkspace {
  const nowIso = now.toISOString()
  const nextNodes = workspace.nodes
    .filter(node => node.id !== target.id)
    .map(node => {
      if (
        target.kind === 'task' &&
        node.id === linkedAgentNodeId(target) &&
        node.kind === 'agent'
      ) {
        const agent = node.agent && typeof node.agent === 'object' ? node.agent : {}
        return { ...node, agent: { ...agent, taskId: null } }
      }

      if (target.kind === 'agent' && node.id === agentTaskId(target) && node.kind === 'task') {
        const task =
          node.task && typeof node.task === 'object' ? (node.task as Record<string, unknown>) : {}
        return {
          ...node,
          task: {
            ...task,
            linkedAgentNodeId: null,
            status: task.status === 'doing' ? 'todo' : task.status,
            updatedAt: nowIso,
          },
        }
      }

      return node
    })

  return {
    ...workspace,
    nodes: nextNodes,
    spaces: workspace.spaces.map(space => ({
      ...space,
      nodeIds: space.nodeIds.filter(nodeId => nodeId !== target.id),
    })),
  }
}

function linkedAgentNodeId(node: NodeControlNode): string | null {
  const task =
    node.task && typeof node.task === 'object' ? (node.task as Record<string, unknown>) : {}
  return typeof task.linkedAgentNodeId === 'string' ? task.linkedAgentNodeId : null
}

function agentTaskId(node: NodeControlNode): string | null {
  const agent =
    node.agent && typeof node.agent === 'object' ? (node.agent as Record<string, unknown>) : {}
  return typeof agent.taskId === 'string' ? agent.taskId : null
}
