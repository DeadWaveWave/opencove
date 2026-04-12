import { resolveAgentModel } from '@contexts/settings/domain/agentSettings'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import type {
  LaunchAgentSessionResult,
  ListMountsResult,
  TerminalRuntimeKind,
} from '@shared/contracts/dto'
import {
  assignAgentNodeToTaskSpace,
  clearStaleTaskLinkedAgent,
  createTaskAgentAnchor,
  findTaskNode,
  findTaskSpace,
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

  const taskSpace = findTaskSpace(taskNodeId, context.spacesRef)
  let mountId = taskSpace?.targetMountId ?? null
  let taskDirectory =
    taskSpace && taskSpace.directoryPath.trim().length > 0
      ? taskSpace.directoryPath.trim()
      : context.workspacePath

  const normalizedWorkspaceId =
    typeof context.workspaceId === 'string' ? context.workspaceId.trim() : ''

  if (!mountId && normalizedWorkspaceId.length > 0) {
    const controlSurfaceInvoke = (
      window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
    ).opencoveApi?.controlSurface?.invoke

    if (typeof controlSurfaceInvoke === 'function') {
      try {
        const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
          kind: 'query',
          id: 'mount.list',
          payload: { projectId: normalizedWorkspaceId },
        })

        const defaultMount = mountResult.mounts[0] ?? null
        if (defaultMount) {
          mountId = defaultMount.mountId
          taskDirectory = defaultMount.rootPath
        }
      } catch (error) {
        setTaskLastError({
          taskNodeId,
          message: context.t('messages.mountListFailed', { message: toErrorMessage(error) }),
          setNodes: context.setNodes,
        })
        context.onRequestPersistFlush?.()
        return
      }
    }
  }
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

  try {
    let launchedSessionId = ''
    let launchedProfileId: string | null = null
    let launchedRuntimeKind: TerminalRuntimeKind | undefined = undefined
    let launchedEffectiveModel: string | null = null
    let agentDirectory = taskDirectory

    if (mountId) {
      const cwdUri = taskDirectory.trim().length > 0 ? toFileUri(taskDirectory.trim()) : null
      const launched = await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
        kind: 'command',
        id: 'session.launchAgentInMount',
        payload: {
          mountId,
          cwdUri,
          prompt: requirement,
          provider,
          mode: 'new',
          model,
          agentFullAccess: context.agentSettings.agentFullAccess,
        },
      })

      launchedSessionId = launched.sessionId
      launchedProfileId = context.agentSettings.defaultTerminalProfileId
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
        agentFullAccess: context.agentSettings.agentFullAccess,
        cols: 80,
        rows: 24,
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
      title: context.buildAgentNodeTitle(provider, launchedEffectiveModel),
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
