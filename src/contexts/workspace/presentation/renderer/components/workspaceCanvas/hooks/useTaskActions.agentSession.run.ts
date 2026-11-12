import { readManagedClaudeExecutionContext } from '../../../utils/managedClaudeLifecycle'
import {
  resolveAgentModel,
  resolveSelectableAgentProvider,
} from '@contexts/settings/domain/agentSettings'
import {
  clearResumeSessionBinding,
  resolveLaunchedAgentResumeBinding,
} from '../../../utils/agentResumeBinding'
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
import type { AgentNodeLaunchOverrides } from './useAgentNodeLifecycle.support'
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
  managed,
  managedDirectory,
}: {
  taskNodeId: string
  linkedAgentNodeId: string
  taskTitle: string
  requirement: string
  taskDirectory: string
  context: TaskActionContext
  managed: boolean
  managedDirectory?: string | null
}): AgentNodeLaunchOverrides | null {
  const linkedAgentNode = context.nodesRef.current.find(node => node.id === linkedAgentNodeId)
  if (!linkedAgentNode || linkedAgentNode.data.kind !== 'agent' || !linkedAgentNode.data.agent) {
    return null
  }

  assignAgentNodeToTaskSpace({
    taskNodeId,
    assignedNodeId: linkedAgentNodeId,
    assignedNode: linkedAgentNode,
    context,
  })

  const now = new Date().toISOString()
  const agentDirectory = managed
    ? managedDirectory!
    : linkedAgentNode.data.agent.directoryMode === 'workspace'
      ? taskDirectory
      : linkedAgentNode.data.agent.executionDirectory

  context.setNodes(prevNodes =>
    prevNodes.map(node => {
      if (node.id === linkedAgentNodeId && node.data.kind === 'agent' && node.data.agent) {
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
              taskId: taskNodeId,
              // Preserve the adoption image until the launch succeeds. Requested
              // prompt/directory belong to the launch, not preparatory publication.
              ...(node.data.agent.provider === 'claude-code'
                ? {}
                : {
                    prompt: requirement,
                    executionDirectory: agentDirectory,
                    expectedDirectory: agentDirectory,
                  }),
              launchMode: 'new',
              ...(!managed && node.data.agent.provider !== 'claude-code'
                ? clearResumeSessionBinding()
                : {}),
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

  return {
    prompt: requirement,
    executionDirectory: agentDirectory,
    expectedDirectory: agentDirectory,
  }
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

  const linkedAgentNodeId = taskNode.data.task.linkedAgentNodeId
  const linked = context.nodesRef.current.find(node => node.id === linkedAgentNodeId)
  let owned
  try {
    owned = linkedAgentNodeId
      ? await readManagedClaudeExecutionContext(linkedAgentNodeId, linked?.data.agent?.provider)
      : null
  } catch (error) {
    setTaskLastError({ taskNodeId, message: toErrorMessage(error), setNodes: context.setNodes })
    return
  }

  const initialBinding = await resolveWorkspaceAgentLaunchBinding({
    workspaceId: context.workspaceId,
    workspacePath: context.workspacePath,
    currentMountId: mountId,
    executionDirectory: taskDirectory,
    targetSpace: taskSpace,
    spacesRef: context.spacesRef,
    onSpacesChange: owned ? undefined : context.onSpacesChange,
    onRequestPersistFlush: owned ? undefined : context.onRequestPersistFlush,
  })
  mountId = initialBinding.mountId
  taskDirectory = initialBinding.executionDirectory
  if (linkedAgentNodeId) {
    if (owned && taskDirectory !== owned.executionDirectory) {
      setTaskLastError({
        taskNodeId,
        message: context.t('messages.managedAgentDirectoryConflict'),
        setNodes: context.setNodes,
      })
      return
    }
    const reused = reuseLinkedAgentForTask({
      managed: Boolean(owned),
      managedDirectory: owned?.executionDirectory,
      taskNodeId,
      linkedAgentNodeId,
      taskTitle: taskNode.data.title,
      requirement,
      taskDirectory,
      context,
    })

    if (reused) {
      await context.launchAgentInNode(linkedAgentNodeId, 'new', reused)
      return
    }

    clearStaleTaskLinkedAgent({
      taskNodeId,
      setNodes: context.setNodes,
    })
    context.onRequestPersistFlush?.()
  }

  const provider = resolveSelectableAgentProvider(context.agentSettings.defaultProvider)
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
    const canvasNodeId = crypto.randomUUID()
    const launched = await launchWorkspaceAgentSession({
      canvasNodeId,
      workspaceId: context.workspaceId,
      spaceId: taskSpace?.id,
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
      nodeId: canvasNodeId,
      sessionId: launched.sessionId,
      ...(launched.managedClaudeLifecycle
        ? { managedClaudeLifecycle: launched.managedClaudeLifecycle }
        : {}),
      profileId: launched.profileId,
      runtimeKind: launched.runtimeKind,
      terminalGeometry: launchGeometry.terminalGeometry,
      workerBinding: launched.workerBinding,
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
        ...resolveLaunchedAgentResumeBinding(provider, 'new', launched.resumeSessionId),
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
      assignedNode: createdAgentNode,
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
