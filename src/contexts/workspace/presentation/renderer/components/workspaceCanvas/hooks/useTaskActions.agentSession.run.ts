import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import {
  resolveAgentExecutablePathOverride,
  resolveAgentLaunchEnv,
  resolveAgentModel,
} from '@contexts/settings/domain/agentSettings'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import type { LaunchAgentSessionResult, TerminalRuntimeKind } from '@shared/contracts/dto'
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
import { resolveSpaceMountLaunchContext } from './spaceMountLaunchContext'

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

  const linkedAgentNodeId = taskNode.data.task.linkedAgentNodeId

  const provider = context.agentSettings.defaultProvider
  const model = resolveAgentModel(context.agentSettings, provider)
  const executablePathOverride = resolveAgentExecutablePathOverride(context.agentSettings, provider)
  const env = resolveAgentLaunchEnv(context.agentSettings, provider)
  const launchGeometry = resolveDefaultAgentLaunchGeometry({
    bucket: context.agentSettings.standardWindowSizeBucket,
    provider,
    terminalFontSize: context.agentSettings.terminalFontSize,
  })
  const mergedEnv =
    context.environmentVariables && Object.keys(context.environmentVariables).length > 0
      ? { ...env, ...context.environmentVariables }
      : env

  try {
    let resolvedTaskSpace = findTaskSpace(taskNodeId, context.spacesRef)
    const shouldFallbackToFirstMount =
      resolvedTaskSpace === null &&
      typeof context.workspaceId === 'string' &&
      context.workspaceId.trim().length > 0
    let mountContext = await resolveSpaceMountLaunchContext({
      workspaceId: context.workspaceId,
      workspacePath: context.workspacePath,
      space: resolvedTaskSpace,
      spaces: context.spacesRef.current,
      onSpacesChange: context.onSpacesChange,
      onRequestPersistFlush: context.onRequestPersistFlush,
      fallbackToFirstMount: shouldFallbackToFirstMount,
    })
    resolvedTaskSpace = mountContext.space
    let mountId = mountContext.mountId
    let taskDirectory = mountContext.workingDirectory

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

    let launchedSessionId = ''
    let launchedProfileId: string | null = null
    let launchedRuntimeKind: TerminalRuntimeKind | undefined = undefined
    let launchedEffectiveModel: string | null = null
    let agentDirectory = taskDirectory

    if (mountId) {
      const invokeLaunchInMount = async (
        nextMountId: string,
      ): Promise<LaunchAgentSessionResult> => {
        const cwdUri = taskDirectory.trim().length > 0 ? toFileUri(taskDirectory.trim()) : null
        return await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
          kind: 'command',
          id: 'session.launchAgentInMount',
          payload: {
            mountId: nextMountId,
            cwdUri,
            prompt: requirement,
            provider,
            mode: 'new',
            model,
            ...(executablePathOverride ? { executablePathOverride } : {}),
            ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
            agentFullAccess: context.agentSettings.agentFullAccess,
            cols: launchGeometry.terminalGeometry.cols,
            rows: launchGeometry.terminalGeometry.rows,
          },
        })
      }

      let launched: LaunchAgentSessionResult
      try {
        launched = await invokeLaunchInMount(mountId)
      } catch (error) {
        mountContext = await resolveSpaceMountLaunchContext({
          workspaceId: context.workspaceId,
          workspacePath: context.workspacePath,
          space: findTaskSpace(taskNodeId, context.spacesRef) ?? resolvedTaskSpace,
          spaces: context.spacesRef.current,
          onSpacesChange: context.onSpacesChange,
          onRequestPersistFlush: context.onRequestPersistFlush,
          fallbackToFirstMount: shouldFallbackToFirstMount,
        })
        const nextMountId = mountContext.mountId
        if (!nextMountId || nextMountId === mountId) {
          throw error
        }

        resolvedTaskSpace = mountContext.space
        mountId = nextMountId
        taskDirectory = mountContext.workingDirectory
        launched = await invokeLaunchInMount(mountId)
      }

      launchedSessionId = launched.sessionId
      launchedProfileId = launched.profileId
      launchedRuntimeKind = launched.runtimeKind ?? undefined
      launchedEffectiveModel = launched.effectiveModel
      agentDirectory = launched.executionContext.workingDirectory
    } else {
      const launched = await window.opencoveApi.agent.launch({
        provider,
        cwd: taskDirectory,
        profileId: context.agentSettings.defaultTerminalProfileId,
        prompt: requirement,
        mode: 'new',
        model,
        ...(executablePathOverride ? { executablePathOverride } : {}),
        ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
        agentFullAccess: context.agentSettings.agentFullAccess,
        cols: launchGeometry.terminalGeometry.cols,
        rows: launchGeometry.terminalGeometry.rows,
      })

      launchedSessionId = launched.sessionId
      launchedProfileId = launched.profileId ?? null
      launchedRuntimeKind = launched.runtimeKind
      launchedEffectiveModel = launched.effectiveModel
    }

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launchedSessionId,
      profileId: launchedProfileId,
      runtimeKind: launchedRuntimeKind,
      terminalGeometry: launchGeometry.terminalGeometry,
      title: context.buildAgentNodeTitle(provider, taskNode.data.title),
      anchor: createTaskAgentAnchor(taskNode),
      kind: 'agent',
      placement: {
        targetSpaceRect: resolvedTaskSpace?.rect ?? null,
        preferredDirection: 'right',
      },
      agent: {
        provider,
        prompt: requirement,
        model,
        effectiveModel: launchedEffectiveModel,
        launchMode: 'new',
        ...clearResumeSessionBinding(),
        executionDirectory: agentDirectory,
        expectedDirectory: agentDirectory,
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
