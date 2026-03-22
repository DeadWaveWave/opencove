import { resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import {
  assignAgentNodeToTaskSpace,
  clearStaleTaskLinkedAgent,
  createTaskAgentAnchor,
  findTaskNode,
  findTaskSpace,
  resolveTaskDirectory,
  setTaskLastError,
  type TaskActionContext,
} from './useTaskActions.agentSession.shared'

function reuseLinkedAgentForTask({
  taskNodeId,
  linkedAgentNodeId,
  requirement,
  taskDirectory,
  context,
}: {
  taskNodeId: string
  linkedAgentNodeId: string
  requirement: string
  taskDirectory: string
  context: TaskActionContext
}): boolean {
  const linkedAgentNode = context.nodesRef.current.find(node => node.id === linkedAgentNodeId)
  if (!linkedAgentNode || linkedAgentNode.data.kind !== 'agent' || !linkedAgentNode.data.agent) {
    return false
  }

  assignAgentNodeToTaskSpace({
    taskNodeId,
    assignedNodeId: linkedAgentNodeId,
    context,
  })

  const now = new Date().toISOString()

  context.setNodes(prevNodes =>
    prevNodes.map(node => {
      if (node.id === linkedAgentNodeId && node.data.kind === 'agent' && node.data.agent) {
        const agentDirectory =
          node.data.agent.directoryMode === 'workspace'
            ? taskDirectory
            : node.data.agent.executionDirectory

        return {
          ...node,
          data: {
            ...node.data,
            agent: {
              ...node.data.agent,
              prompt: requirement,
              taskId: taskNodeId,
              executionDirectory: agentDirectory,
              expectedDirectory: agentDirectory,
              launchMode: 'new',
              ...clearResumeSessionBinding(),
            },
            lastError: null,
          },
        }
      }

      if (node.id === taskNodeId && node.data.kind === 'task' && node.data.task) {
        return {
          ...node,
          data: {
            ...node.data,
            lastError: null,
            task: {
              ...node.data.task,
              status: 'doing',
              linkedAgentNodeId,
              lastRunAt: now,
              updatedAt: now,
            },
          },
        }
      }

      return node
    }),
  )
  context.onRequestPersistFlush?.()

  return true
}

export async function runTaskAgentAction(
  taskNodeId: string,
  context: TaskActionContext,
): Promise<void> {
  const taskNode = findTaskNode(taskNodeId, context.nodesRef)
  if (!taskNode) {
    return
  }

  const requirement = taskNode.data.task.requirement.trim()
  if (requirement.length === 0) {
    setTaskLastError({
      taskNodeId,
      message: context.t('messages.taskRequirementRequired'),
      setNodes: context.setNodes,
    })
    return
  }

  const taskDirectory = resolveTaskDirectory(taskNodeId, context.spacesRef, context.workspacePath)
  const linkedAgentNodeId = taskNode.data.task.linkedAgentNodeId

  if (linkedAgentNodeId) {
    const reused = reuseLinkedAgentForTask({
      taskNodeId,
      linkedAgentNodeId,
      requirement,
      taskDirectory,
      context,
    })

    if (reused) {
      await context.launchAgentInNode(linkedAgentNodeId, 'new')
      return
    }

    clearStaleTaskLinkedAgent({
      taskNodeId,
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
  }

  const provider = context.agentSettings.defaultProvider
  const model = resolveAgentModel(context.agentSettings, provider)
  const taskSpace = findTaskSpace(taskNodeId, context.spacesRef)

  try {
    const launched = await window.opencoveApi.agent.launch({
      provider,
      cwd: taskDirectory,
      prompt: requirement,
      mode: 'new',
      model,
      agentFullAccess: context.agentSettings.agentFullAccess,
      cols: 80,
      rows: 24,
    })

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launched.sessionId,
      title: context.buildAgentNodeTitle(provider, launched.effectiveModel),
      anchor: createTaskAgentAnchor(taskNode),
      kind: 'agent',
      placement: {
        targetSpaceRect: taskSpace?.rect ?? null,
        preferredDirection: 'right',
      },
      agent: {
        provider,
        prompt: requirement,
        model,
        effectiveModel: launched.effectiveModel,
        launchMode: launched.launchMode,
        ...clearResumeSessionBinding(),
        executionDirectory: taskDirectory,
        expectedDirectory: taskDirectory,
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: taskNodeId,
      },
    })

    if (!createdAgentNode) {
      return
    }

    assignAgentNodeToTaskSpace({
      taskNodeId,
      assignedNodeId: createdAgentNode.id,
      context,
    })

    const now = new Date().toISOString()
    context.setNodes(prevNodes =>
      prevNodes.map(node => {
        if (node.id !== taskNodeId || node.data.kind !== 'task' || !node.data.task) {
          return node
        }

        return {
          ...node,
          data: {
            ...node.data,
            task: {
              ...node.data.task,
              status: 'doing',
              linkedAgentNodeId: createdAgentNode.id,
              lastRunAt: now,
              updatedAt: now,
            },
          },
        }
      }),
    )
    context.onRequestPersistFlush?.()
  } catch (error) {
    setTaskLastError({
      taskNodeId,
      message: context.t('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
  }
}
