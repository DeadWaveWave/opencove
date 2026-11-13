import { isSelfOrRecordedDescendant } from '../nodeLineage/nodeDescendants'
import { taskMutationAccessMessage } from '../../../../shared/errors/taskMutationAccessError'
import type {
  ClaimTaskInput,
  ReleaseTaskInput,
  TaskMutationResult,
} from '../../../../shared/contracts/dto/taskMutation'
import { createAppError } from '../../../../shared/errors/appError'
import { findNodeForNodeControl, toCanvasNodeDetail } from './nodeDtos'
import {
  replaceNodeControlWorkspace,
  type NodeControlAppStateStore,
  type NodeControlWorkspace,
  type NodeControlNode,
} from './nodeControlState'
import {
  assertMutationProject,
  commitNodeMutation,
  nodePayload,
  type NodeMutationAuthority,
} from './nodeMutationCommit'

type Options = {
  store: NodeControlAppStateStore
  authority?: NodeMutationAuthority
  assertActive?: () => void
  now: Date
}

function holderOf(workspace: NodeControlWorkspace, task: NodeControlNode) {
  return workspace.nodes.find(
    n => n.id === nodePayload(task.task).linkedAgentNodeId && n.kind === 'agent',
  )
}
function holderDetails(holder: NodeControlNode | undefined) {
  return holder ? { nodeId: holder.id, title: holder.title } : null
}
function taskTarget(state: Parameters<typeof findNodeForNodeControl>[0], id: string) {
  const target = findNodeForNodeControl(state, id)
  if (!target) {
    throw createAppError('node.not_found')
  }
  if (target.node.kind !== 'task') {
    throw createAppError('common.invalid_input', { debugMessage: 'Choose a task node.' })
  }
  return target
}

export async function claimTask(
  options: Options & { input: ClaimTaskInput },
): Promise<TaskMutationResult> {
  const timestamp = options.now.toISOString()
  return commitNodeMutation({
    ...options,
    plan: async state => {
      const target = taskTarget(state.workspaces, options.input.taskNodeId)
      assertMutationProject(target.workspace.id, options.authority)
      const agentId = options.input.agentNodeId ?? options.authority?.nodeId
      if (
        options.authority &&
        (!agentId ||
          !options.authority.nodeId ||
          !(await isSelfOrRecordedDescendant(
            options.store.nodeLineage,
            options.authority.nodeId,
            agentId,
          )))
      ) {
        throw createAppError('common.forbidden', {
          debugMessage: taskMutationAccessMessage,
          details: { reason: 'agent_identity_mismatch' },
        })
      }
      if (!agentId) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Select an agent with --agent.',
        })
      }
      const agent = findNodeForNodeControl(state.workspaces, agentId)
      if (!agent) {
        throw createAppError('node.not_found')
      }
      assertMutationProject(agent.workspace.id, options.authority)
      if (
        agent.node.kind !== 'agent' ||
        agent.workspace.id !== target.workspace.id ||
        agent.spaceId !== target.spaceId
      ) {
        throw createAppError('common.invalid_input', {
          debugMessage: 'Choose an agent in the task’s project and Space.',
        })
      }
      const holder = holderOf(target.workspace, target.node)
      if (holder && holder.id !== agentId) {
        throw createAppError('task.already_claimed', {
          details: { taskNodeId: target.node.id, holder: holderDetails(holder) },
        })
      }
      const newLink = holder?.id !== agentId
      if (
        newLink &&
        state.workspaces.some(w =>
          w.nodes.some(
            n =>
              n.kind === 'task' &&
              n.id !== target.node.id &&
              nodePayload(n.task).linkedAgentNodeId === agentId,
          ),
        )
      ) {
        throw createAppError('common.invalid_input', {
          debugMessage:
            'This agent already holds another task. Release it before claiming this task.',
        })
      }
      const task = nodePayload(target.node.task)
      const reciprocal = nodePayload(agent.node.agent)
      const changed = newLink || task.status !== 'doing' || reciprocal.taskId !== target.node.id
      const nextTask = changed
        ? {
            ...target.node,
            task: {
              ...task,
              status: 'doing',
              linkedAgentNodeId: agentId,
              updatedAt: timestamp,
              ...(newLink ? { lastRunAt: timestamp } : {}),
            },
          }
        : target.node
      const workspace = {
        ...target.workspace,
        nodes: target.workspace.nodes.map(n =>
          n.id === nextTask.id
            ? nextTask
            : n.id === agentId
              ? { ...n, agent: { ...reciprocal, taskId: nextTask.id } }
              : n,
        ),
      }
      return {
        state: replaceNodeControlWorkspace(state, workspace),
        value: {
          changed,
          node: toCanvasNodeDetail({ node: nextTask, workspace, spaceId: target.spaceId }),
        },
      }
    },
  })
}

export async function releaseTask(
  options: Options & { input: ReleaseTaskInput },
): Promise<TaskMutationResult> {
  const timestamp = options.now.toISOString()
  const status = options.input.status ?? 'todo'
  if (!['todo', 'ai_done', 'done'].includes(status)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Release status must be todo, ai_done or done.',
    })
  }
  return commitNodeMutation({
    ...options,
    plan: async state => {
      const target = taskTarget(state.workspaces, options.input.taskNodeId)
      assertMutationProject(target.workspace.id, options.authority)
      const holder = holderOf(target.workspace, target.node)
      if (
        options.authority &&
        (!holder ||
          !options.authority.nodeId ||
          !(await isSelfOrRecordedDescendant(
            options.store.nodeLineage,
            options.authority.nodeId,
            holder.id,
          )))
      ) {
        throw createAppError('common.forbidden', {
          debugMessage: taskMutationAccessMessage,
          details: {
            reason: 'not_current_holder',
            taskNodeId: target.node.id,
            holder: holderDetails(holder),
          },
        })
      }
      const task = nodePayload(target.node.task)
      const reciprocal = nodePayload(holder?.agent)
      const clearReciprocal = holder !== undefined && reciprocal.taskId === target.node.id
      const changed = task.linkedAgentNodeId !== null || task.status !== status || clearReciprocal
      const nextTask = changed
        ? {
            ...target.node,
            task: { ...task, status, linkedAgentNodeId: null, updatedAt: timestamp },
          }
        : target.node
      const workspace = {
        ...target.workspace,
        nodes: target.workspace.nodes.map(n =>
          n.id === nextTask.id
            ? nextTask
            : clearReciprocal && n.id === holder?.id
              ? { ...n, agent: { ...reciprocal, taskId: null } }
              : n,
        ),
      }
      return {
        state: replaceNodeControlWorkspace(state, workspace),
        value: {
          changed,
          node: toCanvasNodeDetail({ node: nextTask, workspace, spaceId: target.spaceId }),
        },
      }
    },
  })
}
