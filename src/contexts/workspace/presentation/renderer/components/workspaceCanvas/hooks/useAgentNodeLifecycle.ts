import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
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
}

export function useWorkspaceCanvasAgentNodeLifecycle({
  nodesRef,
  setNodes,
  bumpAgentLaunchToken,
  isAgentLaunchTokenCurrent,
  agentFullAccess,
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

      if (mode === 'resume' && !isResumeSessionBindingVerified(launchData)) {
        setNodes(prevNodes =>
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
        )
        return
      }

      if (mode === 'new' && launchData.prompt.trim().length === 0) {
        setNodes(prevNodes =>
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

      setNodes(prevNodes =>
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
      )

      try {
        const launched = await window.opencoveApi.agent.launch({
          provider: launchData.provider,
          cwd: launchData.executionDirectory,
          prompt: launchData.prompt,
          mode,
          model: launchData.model,
          resumeSessionId: mode === 'resume' ? launchData.resumeSessionId : null,
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

        setNodes(prevNodes =>
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
                title: buildAgentNodeTitle(launchData.provider, launched.effectiveModel),
                status: resolveInitialAgentRuntimeStatus(launchData.prompt),
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
        )
      } catch (error) {
        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          return
        }

        const errorMessage = t('messages.agentLaunchFailed', { message: toErrorMessage(error) })

        setNodes(prevNodes =>
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
        )
      }
    },
    [
      agentFullAccess,
      buildAgentNodeTitle,
      bumpAgentLaunchToken,
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

      setNodes(prevNodes =>
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
