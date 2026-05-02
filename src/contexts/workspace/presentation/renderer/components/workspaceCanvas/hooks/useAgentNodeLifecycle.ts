import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveEnabledEnvForAgent } from '@contexts/settings/domain/agentEnv'
import type {
  AgentEnvByProvider,
  AgentExecutablePathOverrideByProvider,
} from '@contexts/settings/domain/agentSettings'
import type { AgentSessionSummary, ListMountsResult } from '@shared/contracts/dto'
import type { AgentNodeData, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'
import { appendAgentSessionRecordToTaskHistory } from '../../../utils/agentSessionHistory'
import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
} from '../../../utils/agentResumeBinding'
import { invalidateCachedTerminalScreenState } from '../../terminalNode/screenStateCache'
import { toErrorMessage } from '../helpers'
import {
  buildAgentNodeTitle as formatAgentNodeTitle,
  findLinkedTaskTitleForAgent,
} from '../../../utils/agentTitle'
import {
  findAgentNode,
  launchAgentRuntime,
  normalizeOptionalString,
  resolveAgentRuntimeLaunchFrameSize,
  type RelaunchAgentNodeOptions,
} from './useAgentNodeLifecycle.support'

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
  terminalFontSize: number
  agentEnvByProvider: AgentEnvByProvider
  agentExecutablePathOverrideByProvider?: AgentExecutablePathOverrideByProvider
  environmentVariables?: Record<string, string>
  onRequestPersistFlush?: () => void
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
  terminalFontSize,
  agentEnvByProvider,
  agentExecutablePathOverrideByProvider,
  environmentVariables,
  onRequestPersistFlush,
}: UseAgentNodeLifecycleParams): {
  buildAgentNodeTitle: (provider: AgentNodeData['provider'], label: string | null) => string
  launchAgentInNode: (nodeId: string, mode: 'new' | 'resume') => Promise<void>
  reloadAgentNode: (nodeId: string) => Promise<void>
  listAgentSessionsForNode: (nodeId: string, limit?: number) => Promise<AgentSessionSummary[]>
  switchAgentNodeSession: (nodeId: string, summary: AgentSessionSummary) => Promise<void>
  stopAgentNode: (nodeId: string) => Promise<void>
} {
  const { t } = useTranslation()

  const buildAgentNodeTitle = useCallback(
    (provider: AgentNodeData['provider'], label: string | null): string => {
      return formatAgentNodeTitle(provider, label ?? t('common.defaultModel'))
    },
    [t],
  )

  const setAgentNodeFailure = useCallback(
    (nodeId: string, message: string) => {
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
                lastError: message,
              },
            }
          }),
        { syncLayout: false },
      )
    },
    [setNodes],
  )

  const resolveMountId = useCallback(
    async (nodeId: string): Promise<string | null | undefined> => {
      const owningSpace = spacesRef.current.find(space => space.nodeIds.includes(nodeId)) ?? null
      let mountId = owningSpace?.targetMountId ?? null
      const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''

      if (mountId || normalizedWorkspaceId.length === 0) {
        return mountId
      }

      const controlSurfaceInvoke = (
        window as unknown as { opencoveApi?: { controlSurface?: { invoke?: unknown } } }
      ).opencoveApi?.controlSurface?.invoke

      if (typeof controlSurfaceInvoke !== 'function') {
        return null
      }

      try {
        const mountResult = await window.opencoveApi.controlSurface.invoke<ListMountsResult>({
          kind: 'query',
          id: 'mount.list',
          payload: { projectId: normalizedWorkspaceId },
        })
        mountId = mountResult.mounts[0]?.mountId ?? null
      } catch (error) {
        setAgentNodeFailure(
          nodeId,
          t('messages.mountListFailed', { message: toErrorMessage(error) }),
        )
        return undefined
      }

      return mountId
    },
    [setAgentNodeFailure, spacesRef, t, workspaceId],
  )

  const relaunchAgentNode = useCallback(
    async ({
      nodeId,
      mode,
      executionDirectory,
      expectedDirectory,
      resumeSessionId,
      startedAtOverride,
    }: RelaunchAgentNodeOptions): Promise<void> => {
      const node = findAgentNode(nodeId, nodesRef.current)
      if (!node) {
        return
      }
      const launchData = node.data.agent
      const linkedTaskTitle = findLinkedTaskTitleForAgent(
        nodesRef.current,
        nodeId,
        launchData.taskId ?? null,
      )
      const requestedExecutionDirectory = executionDirectory ?? launchData.executionDirectory
      const requestedExpectedDirectory =
        expectedDirectory === undefined ? launchData.expectedDirectory : expectedDirectory
      const requestedResumeSessionId =
        mode === 'resume'
          ? normalizeOptionalString(
              resumeSessionId ??
                (isResumeSessionBindingVerified(launchData) ? launchData.resumeSessionId : null),
            )
          : null

      if (mode === 'resume' && !requestedResumeSessionId) {
        setAgentNodeFailure(nodeId, t('messages.resumeSessionMissing'))
        return
      }

      if (mode === 'new' && launchData.prompt.trim().length === 0) {
        setAgentNodeFailure(nodeId, t('messages.agentPromptRequired'))
        return
      }
      const mountId = await resolveMountId(nodeId)
      if (mountId === undefined) {
        return
      }
      const env = resolveEnabledEnvForAgent({ rows: agentEnvByProvider[launchData.provider] ?? [] })
      const normalizedExecutablePathOverride =
        agentExecutablePathOverrideByProvider?.[launchData.provider]?.trim() ?? ''
      const executablePathOverride =
        normalizedExecutablePathOverride.length > 0 ? normalizedExecutablePathOverride : null
      const mergedEnv =
        environmentVariables && Object.keys(environmentVariables).length > 0
          ? { ...env, ...environmentVariables }
          : env
      const launchToken = bumpAgentLaunchToken(nodeId)
      const launchFrameSize = resolveAgentRuntimeLaunchFrameSize(node)
      if (!mountId && launchData.shouldCreateDirectory && launchData.directoryMode === 'custom') {
        await window.opencoveApi.workspace.ensureDirectory({ path: requestedExecutionDirectory })

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
                width: launchFrameSize.width,
                height: launchFrameSize.height,
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
        const launched = await launchAgentRuntime({
          node,
          mountId,
          mergedEnv,
          mode,
          executionDirectory: requestedExecutionDirectory,
          resumeSessionId: requestedResumeSessionId,
          agentFullAccess,
          defaultTerminalProfileId,
          executablePathOverride,
          terminalFontSize,
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
                launchMode: mode,
                effectiveModel: launched.effectiveModel,
                executionDirectory: launched.executionDirectory,
                expectedDirectory: mountId
                  ? launched.executionDirectory
                  : requestedExpectedDirectory,
                ...(mode === 'resume'
                  ? {
                      resumeSessionId: requestedResumeSessionId,
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
                  terminalGeometry: launched.terminalGeometry,
                  width: launched.frameSize.width,
                  height: launched.frameSize.height,
                  title:
                    item.data.titlePinnedByUser === true
                      ? item.data.title
                      : buildAgentNodeTitle(
                          launchData.provider,
                          linkedTaskTitle ?? launched.effectiveModel,
                        ),
                  status:
                    mode === 'resume'
                      ? ('standby' as const)
                      : resolveInitialAgentRuntimeStatus(launchData.prompt),
                  startedAt:
                    startedAtOverride ??
                    (mode === 'new'
                      ? launched.startedAt
                      : (item.data.startedAt ?? launched.startedAt)),
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

        setAgentNodeFailure(
          nodeId,
          t('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
        )
      }
    },
    [
      agentEnvByProvider,
      buildAgentNodeTitle,
      bumpAgentLaunchToken,
      environmentVariables,
      isAgentLaunchTokenCurrent,
      nodesRef,
      resolveMountId,
      setAgentNodeFailure,
      setNodes,
      t,
      agentExecutablePathOverrideByProvider,
      agentFullAccess,
      defaultTerminalProfileId,
      terminalFontSize,
    ],
  )

  const launchAgentInNode = useCallback(
    async (nodeId: string, mode: 'new' | 'resume') => {
      await relaunchAgentNode({ nodeId, mode })
    },
    [relaunchAgentNode],
  )

  const reloadAgentNode = useCallback(
    async (nodeId: string) => {
      const node = findAgentNode(nodeId, nodesRef.current)
      if (!node) {
        return
      }

      await relaunchAgentNode({
        nodeId,
        mode: isResumeSessionBindingVerified(node.data.agent) ? 'resume' : 'new',
      })
    },
    [nodesRef, relaunchAgentNode],
  )

  const listAgentSessionsForNode = useCallback(
    async (nodeId: string, limit = 20): Promise<AgentSessionSummary[]> => {
      const node = findAgentNode(nodeId, nodesRef.current)
      if (!node) {
        return []
      }

      const cwd = node.data.agent.executionDirectory.trim()
      if (cwd.length === 0) {
        return []
      }

      const result = await window.opencoveApi.agent.listSessions({
        provider: node.data.agent.provider,
        cwd,
        limit,
      })

      return result.sessions
    },
    [nodesRef],
  )

  const switchAgentNodeSession = useCallback(
    async (nodeId: string, summary: AgentSessionSummary) => {
      const node = findAgentNode(nodeId, nodesRef.current)
      if (!node) {
        return
      }

      if (summary.provider !== node.data.agent.provider) {
        return
      }

      const currentResumeSessionId = isResumeSessionBindingVerified(node.data.agent)
        ? node.data.agent.resumeSessionId
        : null

      if (
        currentResumeSessionId === summary.sessionId &&
        node.data.agent.executionDirectory === summary.cwd
      ) {
        return
      }

      if (currentResumeSessionId && node.data.agent.taskId) {
        const now = new Date().toISOString()
        setNodes(
          prevNodes =>
            appendAgentSessionRecordToTaskHistory({
              prevNodes,
              agentNodeId: nodeId,
              now,
            }),
          { syncLayout: false },
        )
        onRequestPersistFlush?.()
      }

      await relaunchAgentNode({
        nodeId,
        mode: 'resume',
        executionDirectory: summary.cwd,
        expectedDirectory: summary.cwd,
        resumeSessionId: summary.sessionId,
        startedAtOverride: summary.startedAt ?? undefined,
      })
      onRequestPersistFlush?.()
    },
    [nodesRef, onRequestPersistFlush, relaunchAgentNode, setNodes],
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
    reloadAgentNode,
    listAgentSessionsForNode,
    switchAgentNodeSession,
    stopAgentNode,
  }
}
