import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveEnabledEnvForAgent } from '@contexts/settings/domain/agentEnv'
import type { AgentEnvByProvider } from '@contexts/settings/domain/agentSettings'
import type { AgentNodeData, TerminalNodeData } from '../../../types'
import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
} from '../../../utils/agentResumeBinding'
import { invalidateCachedTerminalScreenState } from '../../terminalNode/screenStateCache'
import { providerTitlePrefix, toErrorMessage } from '../helpers'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'

interface UseAgentNodeLifecycleParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
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
  nodesRef,
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

      if (launchData.shouldCreateDirectory && launchData.directoryMode === 'custom') {
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

        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          void window.opencoveApi.pty.kill({ sessionId: launched.sessionId }).catch(() => undefined)
          return
        }

        if (!nodesRef.current.some(item => item.id === nodeId)) {
          void window.opencoveApi.pty.kill({ sessionId: launched.sessionId }).catch(() => undefined)
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
                launchMode: launched.launchMode,
                effectiveModel: launched.effectiveModel,
                ...(mode === 'resume'
                  ? {
                      resumeSessionId: launched.resumeSessionId ?? launchData.resumeSessionId,
                      resumeSessionIdVerified: true,
                    }
                  : clearResumeSessionBinding()),
              }

              return {
                ...item,
                data: {
                  ...item.data,
                  sessionId: launched.sessionId,
                  profileId: launched.profileId,
                  runtimeKind: launched.runtimeKind,
                  title: buildAgentNodeTitle(launchData.provider, launched.effectiveModel),
                  status:
                    launched.launchMode === 'resume'
                      ? ('standby' as const)
                      : resolveInitialAgentRuntimeStatus(launchData.prompt),
                  startedAt:
                    mode === 'new' ? new Date().toISOString() : (item.data.startedAt ?? null),
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
      setNodes,
      t,
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
