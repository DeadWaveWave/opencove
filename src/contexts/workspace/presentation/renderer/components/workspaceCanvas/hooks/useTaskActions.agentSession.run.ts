import { resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import {
  assignAgentNodeToTaskSpace,
  clearStaleTaskLinkedAgent,
  createTaskAgentAnchor,
  findTaskNode,
  findTaskSpace,
  setTaskLastError,
  type TaskActionContext,
} from './useTaskActions.agentSession.shared'
import { resolveDefaultAgentLaunchGeometry } from './agentLaunchGeometry'
import {
  buildMergedAgentLaunchEnv,
  launchWorkspaceAgentSession,
  resolveAgentExecutableOverride,
  resolveWorkspaceAgentLaunchBinding,
} from './useWorkspaceAgentLaunch.shared'

function reuseLinkedAgentForTask({
  taskNodeId,
  linkedAgentNodeId,
  taskTitle,
  requirement,
  taskDirectory,
  context,
}: {
  taskNodeId: string
  linkedAgentNodeId: string
  taskTitle: string
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
            title:
              node.data.titlePinnedByUser === true
                ? node.data.title
                : context.buildAgentNodeTitle(node.data.agent.provider, taskTitle),
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

  const taskSpace = findTaskSpace(taskNodeId, context.spacesRef)
  let mountId = taskSpace?.targetMountId ?? null
  let taskDirectory =
    taskSpace && taskSpace.directoryPath.trim().length > 0
      ? taskSpace.directoryPath.trim()
      : context.workspacePath

  const initialBinding = await resolveWorkspaceAgentLaunchBinding({
    workspaceId: context.workspaceId,
    workspacePath: context.workspacePath,
    currentMountId: mountId,
    executionDirectory: taskDirectory,
    targetSpace: taskSpace,
    spacesRef: context.spacesRef,
    onSpacesChange: context.onSpacesChange,
    onRequestPersistFlush: context.onRequestPersistFlush,
  })
  mountId = initialBinding.mountId
  taskDirectory = initialBinding.executionDirectory
  const linkedAgentNodeId = taskNode.data.task.linkedAgentNodeId

  if (linkedAgentNodeId) {
    const reused = reuseLinkedAgentForTask({
      taskNodeId,
      linkedAgentNodeId,
      taskTitle: taskNode.data.title,
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
  const executablePathOverride = resolveAgentExecutableOverride(context.agentSettings, provider)
  const launchGeometry = resolveDefaultAgentLaunchGeometry({
    bucket: context.agentSettings.standardWindowSizeBucket,
    provider,
    terminalFontSize: context.agentSettings.terminalFontSize,
    terminalDisplayMetrics: context.terminalDisplayMetrics,
  })
  const mergedEnv = buildMergedAgentLaunchEnv(
    context.agentSettings,
    provider,
    context.environmentVariables,
  )

  try {
    const launched = await launchWorkspaceAgentSession({
      mountId,
      workspacePath: context.workspacePath,
      executionDirectory: taskDirectory,
      prompt: requirement,
      provider,
      mode: 'new',
      model,
      executablePathOverride,
      mergedEnv,
      agentSettings: context.agentSettings,
      launchGeometry,
      retryResolveMountBinding: async failedMountId => {
        const nextBinding = await resolveWorkspaceAgentLaunchBinding({
          workspaceId: context.workspaceId,
          workspacePath: context.workspacePath,
          currentMountId: null,
          executionDirectory: taskDirectory,
          targetSpace: taskSpace,
          spacesRef: context.spacesRef,
          onSpacesChange: context.onSpacesChange,
          onRequestPersistFlush: context.onRequestPersistFlush,
        })
        return nextBinding.mountId && nextBinding.mountId !== failedMountId ? nextBinding : null
      },
    })

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launched.sessionId,
      profileId: launched.profileId,
      runtimeKind: launched.runtimeKind,
      terminalGeometry: launchGeometry.terminalGeometry,
      title: context.buildAgentNodeTitle(provider, taskNode.data.title),
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
        launchMode: 'new',
        ...clearResumeSessionBinding(),
        executionDirectory: launched.executionDirectory,
        expectedDirectory: launched.executionDirectory,
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
