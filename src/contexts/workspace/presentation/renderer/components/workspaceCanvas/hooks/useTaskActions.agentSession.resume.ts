import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { resolveAgentLaunchEnv } from '@contexts/settings/domain/agentSettings'
import { isResumeSessionBindingVerified } from '../../../utils/agentResumeBinding'
import { toErrorMessage } from '../helpers'
import type {
  LaunchAgentSessionResult,
  ListMountsResult,
  TerminalRuntimeKind,
} from '@shared/contracts/dto'
import {
  assignAgentNodeToTaskSpace,
  createTaskAgentAnchor,
  findTaskNode,
  findTaskSpace,
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

  const env = resolveAgentLaunchEnv(context.agentSettings, record.provider)

  try {
    let launchedSessionId = ''
    let launchedProfileId: string | null = null
    let launchedRuntimeKind: TerminalRuntimeKind | undefined = undefined
    let launchedEffectiveModel: string | null = null
    let launchedResumeSessionId: string | null = record.resumeSessionId
    let agentDirectory = record.boundDirectory

    if (mountId) {
      const cwd =
        record.boundDirectory.trim().length > 0 ? record.boundDirectory.trim() : taskDirectory
      const cwdUri = cwd.trim().length > 0 ? toFileUri(cwd.trim()) : null
      const launched = await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
        kind: 'command',
        id: 'session.launchAgentInMount',
        payload: {
          mountId,
          cwdUri,
          prompt: record.prompt,
          provider: record.provider,
          mode: 'resume',
          model: record.model,
          resumeSessionId: record.resumeSessionId,
          ...(Object.keys(env).length > 0 ? { env } : {}),
          agentFullAccess: context.agentSettings.agentFullAccess,
        },
      })

      launchedSessionId = launched.sessionId
      launchedProfileId = context.agentSettings.defaultTerminalProfileId
      launchedEffectiveModel = launched.effectiveModel
      launchedResumeSessionId = launched.resumeSessionId ?? record.resumeSessionId
      agentDirectory = launched.executionContext.workingDirectory
    } else {
      const launched = await window.opencoveApi.agent.launch({
        provider: record.provider,
        cwd: record.boundDirectory,
        profileId: context.agentSettings.defaultTerminalProfileId,
        prompt: record.prompt,
        mode: 'resume',
        model: record.model,
        resumeSessionId: record.resumeSessionId,
        ...(Object.keys(env).length > 0 ? { env } : {}),
        agentFullAccess: context.agentSettings.agentFullAccess,
        cols: 80,
        rows: 24,
      })

      launchedSessionId = launched.sessionId
      launchedProfileId = launched.profileId ?? null
      launchedRuntimeKind = launched.runtimeKind
      launchedEffectiveModel = launched.effectiveModel
      launchedResumeSessionId = launched.resumeSessionId ?? record.resumeSessionId
    }

    const createdAgentNode = await context.createNodeForSession({
      sessionId: launchedSessionId,
      profileId: launchedProfileId,
      runtimeKind: launchedRuntimeKind,
      title: context.buildAgentNodeTitle(record.provider, launchedEffectiveModel),
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
        effectiveModel: launchedEffectiveModel,
        launchMode: 'resume',
        resumeSessionId: launchedResumeSessionId,
        resumeSessionIdVerified: true,
        executionDirectory: agentDirectory,
        expectedDirectory: mountId ? agentDirectory : taskDirectory,
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
                      resumeSessionId: launchedResumeSessionId ?? session.resumeSessionId,
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
