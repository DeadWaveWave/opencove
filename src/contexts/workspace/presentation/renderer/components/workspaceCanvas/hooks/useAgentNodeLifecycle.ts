import { requestCanonicalRefresh } from '../../../utils/persistence/canonicalRefresh'
import {
  confirmManagedClaudeRuntime,
  projectManagedClaudeRuntimeData,
} from '../../../utils/managedClaudeProjection'
import { useAgentNodeSessionControls } from './useAgentNodeSessionControls'
import { planManagedClaudeRelaunch } from '@contexts/workspace/application/agentLifecycle/managedClaudeRelaunch'
import { readManagedClaudeBinding } from '../../../utils/managedClaudeLifecycle'
import { requireManagedClaudeWorkerSupport } from '../../../utils/managedClaudeWorkerSupport'
import type {
  ManagedClaudeLaunchIntent,
  ManagedClaudeLifecycleReceipt,
} from '@shared/contracts/managedClaudeLaunch'
import { useCallback } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveEnabledEnvForAgent } from '@contexts/settings/domain/agentEnv'
import type { TerminalClientDisplayCalibration } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { AgentNodeData } from '../../../types'
import { resolveInitialAgentRuntimeStatus } from '../../../utils/agentRuntimeStatus'
import {
  clearResumeSessionBinding,
  isResumeSessionBindingVerified,
  resolveLaunchedAgentResumeBinding,
} from '../../../utils/agentResumeBinding'
import { invalidateCachedTerminalScreenState } from '../../terminalNode/screenStateCache'
import { toErrorMessage } from '../helpers'
import { resolveSpaceMountLaunchContext } from './spaceMountLaunchContext'
import {
  buildAgentNodeTitle as formatAgentNodeTitle,
  findLinkedTaskTitleForAgent,
} from '../../../utils/agentTitle'
import { useAgentNodeSessionSwitch } from './useAgentNodeSessionSwitch'
import type { WorkspaceCanvasProps } from '../types'
import { useCanvasDocumentCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import { resolveTerminalDisplayMetrics } from './useTerminalDisplayMetrics'
import {
  preflightAgentRelaunch,
  findAgentNode,
  launchAgentRuntime,
  normalizeOptionalString,
  resolveAgentRuntimeLaunchFrameSize,
  type AgentNodeLaunchOverrides,
  type RelaunchAgentNodeOptions,
} from './useAgentNodeLifecycle.support'

interface UseAgentNodeLifecycleParams {
  workspaceId: string
  workspacePath: string
  bumpAgentLaunchToken: (nodeId: string) => number
  isAgentLaunchTokenCurrent: (nodeId: string, token: number) => boolean
  /**
   * The launch fields (`agentFullAccess`, `codexReuseRunningAppServer`, `defaultTerminalProfileId`,
   * `terminalFontSize`, `agentEnvByProvider`, `agentExecutablePathOverrideByProvider`) are read
   * from the app's settings when a launch starts, not when this hook renders.
   */
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
  /** What the terminal's measured display adds to the launch geometry; bound by the render. */
  terminalDisplayCalibration: TerminalClientDisplayCalibration | null
  environmentVariables?: Record<string, string>
}

export function useWorkspaceCanvasAgentNodeLifecycle({
  workspaceId,
  workspacePath,
  bumpAgentLaunchToken,
  isAgentLaunchTokenCurrent,
  readAgentSettings,
  terminalDisplayCalibration,
  environmentVariables,
}: UseAgentNodeLifecycleParams) {
  const { t } = useTranslation()
  const { updateNodes } = useCanvasNodeWriter()
  const documentCommands = useCanvasDocumentCommands()
  const readDocument = useReadCanvasDocument()

  const buildAgentNodeTitle = useCallback(
    (provider: AgentNodeData['provider'], label: string | null): string => {
      return formatAgentNodeTitle(provider, label ?? t('common.defaultModel'))
    },
    [t],
  )

  const setAgentNodeFailure = useCallback(
    (nodeId: string, message: string) => {
      updateNodes(
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
    [updateNodes],
  )

  const resolveMountId = useCallback(
    async (nodeId: string): Promise<string | null | undefined> => {
      const owningSpace =
        readDocument().spaces.find(space => space.nodeIds.includes(nodeId)) ?? null
      try {
        const resolvedMountContext = await resolveSpaceMountLaunchContext({
          workspaceId,
          workspacePath,
          space: owningSpace,
          commitSpaceRepair: recipe => documentCommands.updateSpaces(recipe, { flush: true }),
        })
        return resolvedMountContext.mountId
      } catch (error) {
        setAgentNodeFailure(
          nodeId,
          t('messages.mountListFailed', { message: toErrorMessage(error) }),
        )
        return undefined
      }
    },
    [documentCommands, readDocument, setAgentNodeFailure, t, workspaceId, workspacePath],
  )

  const relaunchAgentNode = useCallback(
    async ({
      nodeId,
      mode,
      executionDirectory,
      expectedDirectory,
      prompt,
      resumeSessionId,
      startedAtOverride,
      intent: explicitIntent,
    }: RelaunchAgentNodeOptions): Promise<ManagedClaudeLifecycleReceipt | undefined> => {
      const node = findAgentNode(nodeId, readDocument().nodes)
      if (!node) {
        return undefined
      }
      // The launch is the user's settings as they were when it started, whatever an await lets
      // them become: one read, here, never a copy made when this hook rendered.
      const settings = readAgentSettings()
      const launchData = prompt === undefined ? node.data.agent : { ...node.data.agent, prompt }
      if (!preflightAgentRelaunch(nodeId, mode, launchData, updateNodes)) {
        return undefined
      }
      let binding
      try {
        await requireManagedClaudeWorkerSupport(launchData.provider)
        binding = await readManagedClaudeBinding(nodeId, launchData.provider)
      } catch (error) {
        setAgentNodeFailure(nodeId, toErrorMessage(error))
        return undefined
      }
      const intent: ManagedClaudeLaunchIntent | undefined =
        explicitIntent ??
        planManagedClaudeRelaunch(binding, mode, resumeSessionId, launchData.provider)
      const linkedTaskTitle = findLinkedTaskTitleForAgent(
        readDocument().nodes,
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

      if (mode === 'resume' && !requestedResumeSessionId && !binding) {
        setAgentNodeFailure(nodeId, t('messages.resumeSessionMissing'))
        return undefined
      }

      if (mode === 'new' && launchData.prompt.trim().length === 0) {
        setAgentNodeFailure(nodeId, t('messages.agentPromptRequired'))
        return undefined
      }
      const mountId =
        binding && node.data.workerBinding
          ? node.data.workerBinding.mountId
          : await resolveMountId(nodeId)
      if (mountId === undefined) {
        return undefined
      }
      const env = resolveEnabledEnvForAgent({
        rows: settings.agentEnvByProvider[launchData.provider] ?? [],
      })
      const normalizedExecutablePathOverride =
        settings.agentExecutablePathOverrideByProvider?.[launchData.provider]?.trim() ?? ''
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
          return undefined
        }
      }

      if (!binding && node.data.sessionId.length > 0) {
        invalidateCachedTerminalScreenState(nodeId, node.data.sessionId)
        await window.opencoveApi.pty.kill({ sessionId: node.data.sessionId })

        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          return undefined
        }
      }

      if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
        return undefined
      }
      updateNodes(
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
                recoveryIssue: null,
                agent:
                  !binding && !intent && mode === 'new' && item.data.agent
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
          intent,
          mountId,
          mergedEnv,
          mode,
          executionDirectory: requestedExecutionDirectory,
          prompt: launchData.prompt,
          resumeSessionId: requestedResumeSessionId,
          agentFullAccess: settings.agentFullAccess,
          codexReuseRunningAppServer: settings.codexReuseRunningAppServer,
          defaultTerminalProfileId: settings.defaultTerminalProfileId,
          executablePathOverride,
          terminalFontSize: settings.terminalFontSize,
          terminalDisplayMetrics: resolveTerminalDisplayMetrics({
            terminalFontSize: settings.terminalFontSize,
            terminalDisplayCalibration,
          }),
        })

        if (binding && !launched.managedClaudeLifecycle) {
          requestCanonicalRefresh({ reason: 'uncertain' })
          return undefined
        }
        if (launched.managedClaudeLifecycle) {
          const current = readDocument().nodes.find(item => item.id === nodeId)
          if (!current || !isAgentLaunchTokenCurrent(nodeId, launchToken)) {
            return undefined
          }
          const confirmed = await confirmManagedClaudeRuntime(nodeId, {
            ...current.data,
            sessionId: launched.sessionId,
            managedClaudeBindingObservation: launched.managedClaudeLifecycle.binding,
          })
          if (!confirmed) {
            return undefined
          }
        }
        const ownsNode = binding || launched.managedClaudeLifecycle?.binding.nodeSeen
        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          if (!launched.managedClaudeLifecycle) {
            void window.opencoveApi.pty
              .kill({ sessionId: launched.sessionId })
              .catch(() => undefined)
          }
          return undefined
        }

        if (!readDocument().nodes.some(item => item.id === nodeId)) {
          if (!launched.managedClaudeLifecycle) {
            void window.opencoveApi.pty
              .kill({ sessionId: launched.sessionId })
              .catch(() => undefined)
          }
          return undefined
        }

        updateNodes(
          prevNodes =>
            prevNodes.map(item => {
              if (item.id !== nodeId) {
                return item
              }

              const runtimeData = launched.managedClaudeLifecycle
                ? projectManagedClaudeRuntimeData(nodeId, {
                    ...item.data,
                    sessionId: launched.sessionId,
                    managedClaudeBindingObservation: launched.managedClaudeLifecycle.binding,
                  })
                : item.data
              if (!runtimeData) {
                return item
              }
              const nextAgentData: AgentNodeData = {
                ...launchData,
                taskId: item.data.agent?.taskId ?? null,
                launchMode: mode,
                effectiveModel: launched.effectiveModel,
                executionDirectory: launched.executionDirectory,
                expectedDirectory: mountId
                  ? launched.executionDirectory
                  : requestedExpectedDirectory,
                ...resolveLaunchedAgentResumeBinding(
                  launchData.provider,
                  mode,
                  launched.managedClaudeLifecycle
                    ? launched.managedClaudeLifecycle.binding.tuple.resumeSessionId
                    : mode === 'resume'
                      ? requestedResumeSessionId
                      : launched.resumeSessionId,
                ),
              }

              return {
                ...item,
                data: {
                  ...runtimeData,
                  sessionId: launched.sessionId,
                  profileId: launched.profileId,
                  runtimeKind: launched.runtimeKind,
                  terminalGeometry: launched.terminalGeometry,
                  workerBinding: ownsNode ? item.data.workerBinding : launched.workerBinding,
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
                  agent: runtimeData.managedClaudeResumeBindingOwnership
                    ? {
                        ...nextAgentData,
                        resumeSessionId: runtimeData.agent?.resumeSessionId ?? null,
                        resumeSessionIdVerified:
                          runtimeData.agent?.resumeSessionIdVerified === true,
                      }
                    : nextAgentData,
                },
              }
            }),
          { syncLayout: false },
        )
        return launched.managedClaudeLifecycle
      } catch (error) {
        if (!isAgentLaunchTokenCurrent(nodeId, launchToken)) {
          return undefined
        }

        setAgentNodeFailure(
          nodeId,
          t('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
        )
        return undefined
      }
    },
    [
      buildAgentNodeTitle,
      bumpAgentLaunchToken,
      environmentVariables,
      isAgentLaunchTokenCurrent,
      readAgentSettings,
      readDocument,
      resolveMountId,
      setAgentNodeFailure,
      t,
      terminalDisplayCalibration,
      updateNodes,
    ],
  )

  const launchAgentInNode = useCallback(
    async (nodeId: string, mode: 'new' | 'resume', overrides?: AgentNodeLaunchOverrides) => {
      await relaunchAgentNode({ ...overrides, nodeId, mode })
    },
    [relaunchAgentNode],
  )

  const reloadAgentNode = useCallback(
    async (nodeId: string) => {
      const node = findAgentNode(nodeId, readDocument().nodes)
      if (!node) {
        return
      }

      try {
        const binding = await readManagedClaudeBinding(nodeId, node.data.agent.provider)
        await relaunchAgentNode({
          nodeId,
          mode: binding || isResumeSessionBindingVerified(node.data.agent) ? 'resume' : 'new',
          ...(binding ? { intent: { kind: 'resumeCurrent' } } : {}),
        })
      } catch (error) {
        setAgentNodeFailure(nodeId, toErrorMessage(error))
      }
    },
    [readDocument, relaunchAgentNode, setAgentNodeFailure],
  )

  const switchAgentNodeSession = useAgentNodeSessionSwitch({ relaunchAgentNode })

  const { listAgentSessionsForNode, stopAgentNode } = useAgentNodeSessionControls({
    bumpAgentLaunchToken,
  })

  return {
    buildAgentNodeTitle,
    launchAgentInNode,
    reloadAgentNode,
    listAgentSessionsForNode,
    switchAgentNodeSession,
    stopAgentNode,
  }
}
