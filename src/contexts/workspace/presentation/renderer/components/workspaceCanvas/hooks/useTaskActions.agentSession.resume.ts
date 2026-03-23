import { isResumeSessionBindingVerified } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import {
  assignAgentNodeToTaskSpace,
  createTaskAgentAnchor,
  findTaskNode,
  findTaskSpace,
  resolveTaskDirectory,
  setTaskLastError,
  type ResumeTaskAgentSessionContext,
} from './useTaskActions.agentSession.shared'

export async function resumeTaskAgentSessionAction(
  taskNodeId: string,
  recordId: string,
  context: ResumeTaskAgentSessionContext,
): Promise<void> {
  const taskNode = findTaskNode(taskNodeId, context.nodesRef)
  if (!taskNode) {
    return
  }

  if (taskNode.data.task.linkedAgentNodeId) {
    setTaskLastError({
      taskNodeId,
      message: context.t('messages.taskLinkedAgentWindowOpen'),
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
    return
  }

  const record = (taskNode.data.task.agentSessions ?? []).find(item => item.id === recordId)
  if (!record) {
    return
  }

  if (!isResumeSessionBindingVerified(record)) {
    setTaskLastError({
      taskNodeId,
      message: context.t('messages.taskResumeSessionMissing'),
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
    return
  }

  const taskDirectory = resolveTaskDirectory(taskNodeId, context.spacesRef, context.workspacePath)
  const taskSpace = findTaskSpace(taskNodeId, context.spacesRef)

  try {
    const launched = await window.opencoveApi.agent.launch({
      provider: record.provider,
      cwd: record.boundDirectory,
      prompt: record.prompt,
      mode: 'resume',
      model: record.model,
      resumeSessionId: record.resumeSessionId,
      agentFullAccess: context.agentSettings.agentFullAccess,
      cols: 80,
      rows: 24,
    })

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launched.sessionId,
      title: context.buildAgentNodeTitle(record.provider, launched.effectiveModel),
      anchor: createTaskAgentAnchor(taskNode),
      kind: 'agent',
      placement: {
        targetSpaceRect: taskSpace?.rect ?? null,
        preferredDirection: 'right',
      },
      agent: {
        provider: record.provider,
        prompt: record.prompt,
        model: record.model,
        effectiveModel: launched.effectiveModel,
        launchMode: launched.launchMode,
        resumeSessionId: launched.resumeSessionId ?? record.resumeSessionId,
        resumeSessionIdVerified: true,
        executionDirectory: record.boundDirectory,
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
            lastError: null,
            task: {
              ...node.data.task,
              status: 'doing',
              linkedAgentNodeId: createdAgentNode.id,
              lastRunAt: now,
              agentSessions: (node.data.task.agentSessions ?? []).map(session =>
                session.id === recordId
                  ? {
                      ...session,
                      lastRunAt: now,
                      lastDirectory: taskDirectory,
                      resumeSessionId: launched.resumeSessionId ?? session.resumeSessionId,
                      resumeSessionIdVerified: true,
                    }
                  : session,
              ),
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
      message: context.t('messages.agentResumeFailed', { message: toErrorMessage(error) }),
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
  }
}
