import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { resolveAgentLaunchEnv, resolveAgentModel } from '@contexts/settings/domain/agentSettings'
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

function normalizePathForMountComparison(path: string): string {
  return path
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
}

function mountContainsPath(mountRootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizePathForMountComparison(mountRootPath)
  const normalizedTarget = normalizePathForMountComparison(targetPath)

  if (normalizedRoot.length === 0 || normalizedTarget.length === 0) {
    return false
  }

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

function resolveBestMount(
  mounts: ListMountsResult['mounts'],
  taskDirectory: string,
): ListMountsResult['mounts'][number] | null {
  if (!Array.isArray(mounts) || mounts.length === 0) {
    return null
  }

  const normalizedTaskDirectory = normalizePathForMountComparison(taskDirectory)
  if (normalizedTaskDirectory.length === 0) {
    return mounts[0] ?? null
  }

  const matches = mounts
    .filter(mount => mountContainsPath(mount.rootPath, normalizedTaskDirectory))
    .sort(
      (a, b) =>
        normalizePathForMountComparison(b.rootPath).length -
        normalizePathForMountComparison(a.rootPath).length,
    )

  return matches[0] ?? mounts[0] ?? null
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

  const controlSurfaceInvoke = (
    window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
  ).opencoveApi?.controlSurface?.invoke

  const canQueryMounts =
    typeof controlSurfaceInvoke === 'function' && normalizedWorkspaceId.length > 0

  const listMounts = async (): Promise<ListMountsResult | null> => {
    if (!canQueryMounts) {
      return null
    }

    try {
      return await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
        kind: 'query',
        id: 'mount.list',
        payload: { projectId: normalizedWorkspaceId },
      })
    } catch {
      return null
    }
  }

  const updateTaskSpaceTargetMountId = (nextMountId: string): void => {
    if (!taskSpace || taskSpace.targetMountId === nextMountId) {
      return
    }

    const updatedSpaces = context.spacesRef.current.map(space =>
      space.id === taskSpace.id ? { ...space, targetMountId: nextMountId } : space,
    )
    context.onSpacesChange(updatedSpaces)
    context.onRequestPersistFlush?.()
  }

  const mountResult = await listMounts()
  if (mountResult && mountResult.mounts.length > 0) {
    const hasMountId =
      typeof mountId === 'string' &&
      mountId.trim().length > 0 &&
      mountResult.mounts.some(mount => mount.mountId === mountId)

    if (!hasMountId) {
      const resolvedMount = resolveBestMount(mountResult.mounts, taskDirectory)
      if (resolvedMount) {
        mountId = resolvedMount.mountId
        updateTaskSpaceTargetMountId(mountId)

        const normalizedTaskDirectory = taskDirectory.trim().replace(/[\\/]+$/, '')
        const normalizedWorkspacePath = context.workspacePath.trim().replace(/[\\/]+$/, '')
        if (
          normalizedTaskDirectory.length === 0 ||
          normalizedTaskDirectory === normalizedWorkspacePath
        ) {
          taskDirectory = resolvedMount.rootPath
        }
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
  const env = resolveAgentLaunchEnv(context.agentSettings, provider)

  try {
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
            ...(Object.keys(env).length > 0 ? { env } : {}),
            agentFullAccess: context.agentSettings.agentFullAccess,
          },
        })
      }

      let launched: LaunchAgentSessionResult
      try {
        launched = await invokeLaunchInMount(mountId)
      } catch (error) {
        const refreshedMounts = await listMounts()
        const nextMount = refreshedMounts
          ? resolveBestMount(refreshedMounts.mounts, taskDirectory)
          : null

        if (!nextMount || nextMount.mountId === mountId) {
          throw error
        }

        mountId = nextMount.mountId
        updateTaskSpaceTargetMountId(mountId)
        launched = await invokeLaunchInMount(mountId)
      }

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
        ...(Object.keys(env).length > 0 ? { env } : {}),
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
