import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { resolveEnabledEnvForAgent } from '@contexts/settings/domain/agentEnv'
import type { AgentEnvByProvider } from '@contexts/settings/domain/agentSettings'
import type { LaunchAgentSessionResult, ListMountsResult } from '@shared/contracts/dto'
import type { AgentNodeData, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
} from '../../../utils/agentResumeBinding'
import { invalidateCachedTerminalScreenState } from '../../terminalNode/screenStateCache'
import { providerTitlePrefix, toErrorMessage } from '../helpers'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'

interface UseAgentNodeLifecycleParams {
  workspaceId: string
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  bumpAgentLaunchToken: (nodeId: string) => number
  isAgentLaunchTokenCurrent: (nodeId: string, token: number) => boolean
  agentFullAccess: boolean
  defaultTerminalProfileId: string | null
  agentEnvByProvider: AgentEnvByProvider
}

export function useWorkspaceCanvasAgentNodeLifecycle({
  workspaceId,
  nodesRef,
  spacesRef,
  setNodes,
  bumpAgentLaunchToken,
  isAgentLaunchTokenCurrent,
  agentFullAccess,
  defaultTerminalProfileId,
  agentEnvByProvider,
}: UseAgentNodeLifecycleParams): {
  buildAgentNodeTitle: (
    provider: AgentNodeData['provider'],
    effectiveModel: string | null,
  ) => string
  launchAgentInNode: (nodeId: string, mode: 'new' | 'resume') => Promise<void>
  stopAgentNode: (nodeId: string) => Promise<void>
} {
  const { t } = useTranslation()
  const buildAgentNodeTitle = useCallback(
    (provider: AgentNodeData['provider'], effectiveModel: string | null): string => {
      return `${providerTitlePrefix(provider)} · ${effectiveModel ?? t('common.defaultModel')}`
    },
    [t],
  )

  const launchAgentInNode = useCallback(
    async (nodeId: string, mode: 'new' | 'resume') => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node || node.data.kind !== 'agent' || !node.data.agent) {
        return
      }

      const launchData = node.data.agent
      const env = resolveEnabledEnvForAgent({ rows: agentEnvByProvider[launchData.provider] ?? [] })
      const owningSpace = spacesRef.current.find(space => space.nodeIds.includes(nodeId)) ?? null
      let mountId = owningSpace?.targetMountId ?? null

      const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''

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
            mountId = mountResult.mounts[0]?.mountId ?? null
          } catch (error) {
            setNodes(
              prevNodes =>
                prevNodes.map(item => {
                  if (item.id !== nodeId) {
                    return item
                  }

                  return {
                    ...item,
                    data: {
                      ...item.data,
                      status: 'failed',
                      lastError: t('messages.mountListFailed', { message: toErrorMessage(error) }),
                    },
                  }
                }),
              { syncLayout: false },
            )
            return
          }
        }
      }

      if (mode === 'resume' && !isResumeSessionBindingVerified(launchData)) {
        setNodes(
          prevNodes =>
            prevNodes.map(item => {
              if (item.id !== nodeId) {
                return item
              }

              return {
                ...item,
                data: {
                  ...item.data,
                  status: 'failed',
                  lastError: t('messages.resumeSessionMissing'),
                },
              }
            }),
          { syncLayout: false },
        )
        return
      }

      if (mode === 'new' && launchData.prompt.trim().length === 0) {
        setNodes(
          prevNodes =>
            prevNodes.map(item => {
              if (item.id !== nodeId) {
                return item
              }

              return {
                ...item,
                data: {
                  ...item.data,
                  status: 'failed',
                  lastError: t('messages.agentPromptRequired'),
                },
              }
            }),
          { syncLayout: false },
        )
        return
      }

      const launchToken = bumpAgentLaunchToken(nodeId)

      if (!mountId && launchData.shouldCreateDirectory && launchData.directoryMode === 'custom') {
        await window.opencoveApi.workspace.ensureDirectory({ path: launchData.executionDirectory })

        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          return
        }
      }

      if (node.data.sessionId.length > 0) {
        invalidateCachedTerminalScreenState(nodeId, node.data.sessionId)
        await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })

        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          return
        }
      }

      if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
        return
      }

      setNodes(
        prevNodes =>
          prevNodes.map(item => {
            if (item.id !== nodeId) {
              return item
            }

            return {
              ...item,
              data: {
                ...item.data,
                status: 'restoring',
                endedAt: null,
                exitCode: null,
                lastError: null,
                agent:
                  mode === 'new' && item.data.agent
                    ? {
                        ...item.data.agent,
                        launchMode: 'new',
                        ...clearResumeSessionBinding(),
                      }
                    : item.data.agent,
              },
            }
          }),
        { syncLayout: false },
      )

      try {
        let launchedSessionId = ''
        let launchedProfileId = node.data.profileId ?? defaultTerminalProfileId
        let launchedRuntimeKind = node.data.runtimeKind
        let launchedEffectiveModel: string | null = null
        let launchedResumeSessionId: string | null = null
        let launchedStartedAt = new Date().toISOString()
        let launchedExecutionDirectory = launchData.executionDirectory

        if (mountId) {
          const cwd = launchData.executionDirectory.trim()
          const cwdUri = cwd.length > 0 ? toFileUri(cwd) : null
          const launched = await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>(
            {
              kind: 'command',
              id: 'session.launchAgentInMount',
              payload: {
                mountId,
                cwdUri,
                prompt: launchData.prompt,
                provider: launchData.provider,
                mode,
                model: launchData.model,
                resumeSessionId: mode === 'resume' ? launchData.resumeSessionId : null,
                ...(Object.keys(env).length > 0 ? { env } : {}),
                agentFullAccess,
              },
            },
          )

          launchedSessionId = launched.sessionId
          launchedEffectiveModel = launched.effectiveModel
          launchedResumeSessionId = launched.resumeSessionId
          launchedStartedAt = launched.startedAt
          launchedExecutionDirectory = launched.executionContext.workingDirectory
        } else {
          const launched = await window.opencoveApi.agent.launch({
            provider: launchData.provider,
            cwd: launchData.executionDirectory,
            profileId: node.data.profileId ?? defaultTerminalProfileId,
            prompt: launchData.prompt,
            mode,
            model: launchData.model,
            resumeSessionId: mode === 'resume' ? launchData.resumeSessionId : null,
            ...(Object.keys(env).length > 0 ? { env } : {}),
            agentFullAccess,
            cols: 80,
            rows: 24,
          })

          launchedSessionId = launched.sessionId
          launchedProfileId = launched.profileId
          launchedRuntimeKind = launched.runtimeKind
          launchedEffectiveModel = launched.effectiveModel
          launchedResumeSessionId = launched.resumeSessionId ?? null
        }

        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          void window.opencoveApi.pty.kill({ sessionId: launchedSessionId }).catch(() => undefined)
          return
        }

        if (!nodesRef.current.some(item => item.id === nodeId)) {
          void window.opencoveApi.pty.kill({ sessionId: launchedSessionId }).catch(() => undefined)
          return
        }

        setNodes(
          prevNodes =>
            prevNodes.map(item => {
              if (item.id !== nodeId) {
                return item
              }

              const nextAgentData: AgentNodeData = {
                ...launchData,
                launchMode: mode,
                effectiveModel: launchedEffectiveModel,
                executionDirectory: launchedExecutionDirectory,
                expectedDirectory: mountId
                  ? launchedExecutionDirectory
                  : launchData.expectedDirectory,
                ...(mode === 'resume'
                  ? {
                      resumeSessionId: launchedResumeSessionId ?? launchData.resumeSessionId,
                      resumeSessionIdVerified: true,
                    }
                  : clearResumeSessionBinding()),
              }

              return {
                ...item,
                data: {
                  ...item.data,
                  sessionId: launchedSessionId,
                  profileId: launchedProfileId,
                  runtimeKind: launchedRuntimeKind,
                  title: buildAgentNodeTitle(launchData.provider, launchedEffectiveModel),
                  status:
                    mode === 'resume'
                      ? ('standby' as const)
                      : resolveInitialAgentRuntimeStatus(launchData.prompt),
                  startedAt: mode === 'new' ? launchedStartedAt : (item.data.startedAt ?? null),
                  endedAt: null,
                  exitCode: null,
                  lastError: null,
                  scrollback: mode === 'new' ? null : item.data.scrollback,
                  agent: nextAgentData,
                },
              }
            }),
          { syncLayout: false },
        )
      } catch (error) {
        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          return
        }

        const errorMessage = t('messages.agentLaunchFailed', { message: toErrorMessage(error) })

        setNodes(
          prevNodes =>
            prevNodes.map(item => {
              if (item.id !== nodeId) {
                return item
              }

              return {
                ...item,
                data: {
                  ...item.data,
                  status: 'failed',
                  endedAt: new Date().toISOString(),
                  lastError: errorMessage,
                },
              }
            }),
          { syncLayout: false },
        )
      }
    },
    [
      agentEnvByProvider,
      agentFullAccess,
      buildAgentNodeTitle,
      bumpAgentLaunchToken,
      defaultTerminalProfileId,
      isAgentLaunchTokenCurrent,
      nodesRef,
      spacesRef,
      setNodes,
      t,
      workspaceId,
    ],
  )

  const stopAgentNode = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find(item => item.id === nodeId)
      if (!node || node.data.kind !== 'agent') {
        return
      }

      bumpAgentLaunchToken(nodeId)

      if (node.data.sessionId.length > 0) {
        invalidateCachedTerminalScreenState(nodeId, node.data.sessionId)
        await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })
      }

      setNodes(
        prevNodes =>
          prevNodes.map(item => {
            if (item.id !== nodeId) {
              return item
            }

            return {
              ...item,
              data: {
                ...item.data,
                status: 'stopped',
                endedAt: new Date().toISOString(),
                exitCode: null,
              },
            }
          }),
        { syncLayout: false },
      )
    },
    [bumpAgentLaunchToken, nodesRef, setNodes],
  )

  return {
    buildAgentNodeTitle,
    launchAgentInNode,
    stopAgentNode,
  }
}
