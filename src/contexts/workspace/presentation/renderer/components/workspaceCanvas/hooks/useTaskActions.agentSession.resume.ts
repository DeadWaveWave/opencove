import { isResumeSessionBindingVerified } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import {
  assignAgentNodeToTaskSpace,
  createTaskAgentAnchor,
  findTaskNode,
  findTaskSpace,
  setTaskLastError,
  type ResumeTaskAgentSessionContext,
} from './useTaskActions.agentSession.shared'
import { resolveDefaultAgentLaunchGeometry } from './agentLaunchGeometry'
import {
  buildMergedAgentLaunchEnv,
  launchWorkspaceAgentSession,
  resolveAgentExecutableOverride,
  resolveWorkspaceAgentLaunchBinding,
} from './useWorkspaceAgentLaunch.shared'

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

  const taskSpace = findTaskSpace(taskNodeId, context.spacesRef)
  const taskDirectory =
    taskSpace && taskSpace.directoryPath.trim().length > 0
      ? taskSpace.directoryPath.trim()
      : context.workspacePath
  const resumeExecutionDirectory =
    record.boundDirectory.trim().length > 0 ? record.boundDirectory.trim() : taskDirectory

  let initialBinding: Awaited<ReturnType<typeof resolveWorkspaceAgentLaunchBinding>>
  try {
    initialBinding = await resolveWorkspaceAgentLaunchBinding({
      workspaceId: context.workspaceId,
      workspacePath: context.workspacePath,
      currentMountId: taskSpace?.targetMountId ?? null,
      executionDirectory: resumeExecutionDirectory,
      targetSpace: taskSpace,
      spacesRef: context.spacesRef,
      onSpacesChange: context.onSpacesChange,
      onRequestPersistFlush: context.onRequestPersistFlush,
      mountQueryFailurePolicy: 'throw',
    })
  } catch (error) {
    setTaskLastError({
      taskNodeId,
      message: context.t('messages.mountListFailed', { message: toErrorMessage(error) }),
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
    return
  }

  const executablePathOverride = resolveAgentExecutableOverride(
    context.agentSettings,
    record.provider,
  )
  const mergedEnv = buildMergedAgentLaunchEnv(
    context.agentSettings,
    record.provider,
    context.environmentVariables,
  )
  const launchGeometry = resolveDefaultAgentLaunchGeometry({
    bucket: context.agentSettings.standardWindowSizeBucket,
    provider: record.provider,
    terminalFontSize: context.agentSettings.terminalFontSize,
    terminalDisplayMetrics: context.terminalDisplayMetrics,
  })

  try {
    const launched = await launchWorkspaceAgentSession({
      mountId: initialBinding.mountId,
      workspacePath: context.workspacePath,
      executionDirectory: initialBinding.executionDirectory,
      prompt: record.prompt,
      provider: record.provider,
      mode: 'resume',
      model: record.model,
      resumeSessionId: record.resumeSessionId,
      executablePathOverride,
      mergedEnv,
      agentSettings: context.agentSettings,
      launchGeometry,
      retryResolveMountBinding: async failedMountId => {
        const nextBinding = await resolveWorkspaceAgentLaunchBinding({
          workspaceId: context.workspaceId,
          workspacePath: context.workspacePath,
          currentMountId: null,
          executionDirectory: resumeExecutionDirectory,
          targetSpace: taskSpace,
          spacesRef: context.spacesRef,
          onSpacesChange: context.onSpacesChange,
          onRequestPersistFlush: context.onRequestPersistFlush,
          mountQueryFailurePolicy: 'throw',
        })
        return nextBinding.mountId && nextBinding.mountId !== failedMountId ? nextBinding : null
      },
    })

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launched.sessionId,
      profileId: launched.profileId,
      runtimeKind: launched.runtimeKind,
      terminalGeometry: launchGeometry.terminalGeometry,
      title: context.buildAgentNodeTitle(record.provider, taskNode.data.title),
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
        launchMode: 'resume',
        resumeSessionId: record.resumeSessionId,
        resumeSessionIdVerified: true,
        executionDirectory: launched.executionDirectory,
        expectedDirectory: initialBinding.mountId ? launched.executionDirectory : taskDirectory,
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
                      resumeSessionId: session.resumeSessionId,
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
