import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveAgentExecutablePathOverride,
  resolveAgentModel,
  resolveAgentLaunchEnv,
  type AgentSettings,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import type { AgentNodeData, Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { resolveNodePlacementAnchorFromViewportCenter, toErrorMessage } from '../helpers'
import type { ContextMenuState, CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import type { LaunchAgentSessionResult } from '@shared/contracts/dto'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'
import { resolveDefaultAgentLaunchGeometry } from './agentLaunchGeometry'
import { resolveSpaceMountLaunchContext } from './spaceMountLaunchContext'

interface UseAgentLauncherParams {
  agentSettings: AgentSettings
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  standardWindowSizeBucket: StandardWindowSizeBucket
  buildAgentNodeTitle: (
    provider: AgentNodeData['provider'],
    effectiveModel: string | null,
  ) => string
}

export function useWorkspaceCanvasAgentLauncher({
  agentSettings,
  workspaceId,
  workspacePath,
  environmentVariables,
  nodesRef,
  setNodes,
  spacesRef,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
  contextMenu,
  setContextMenu,
  createNodeForSession,
  standardWindowSizeBucket,
  buildAgentNodeTitle,
}: UseAgentLauncherParams): {
  openAgentLauncher: () => void
  openAgentLauncherForProvider: (provider: AgentNodeData['provider']) => void
} {
  const { t } = useTranslation()

  const openAgentLauncherForProvider = useCallback(
    (provider: AgentNodeData['provider']) => {
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }

      setContextMenu(null)

      void (async () => {
        try {
          const cursorAnchor: Point = {
            x: contextMenu.flowX,
            y: contextMenu.flowY,
          }
          const launchGeometry = resolveDefaultAgentLaunchGeometry({
            bucket: standardWindowSizeBucket,
            provider,
            terminalFontSize: agentSettings.terminalFontSize,
          })
          const anchor = resolveNodePlacementAnchorFromViewportCenter(
            cursorAnchor,
            launchGeometry.frameSize,
          )
          const model = resolveAgentModel(agentSettings, provider)
          const executablePathOverride = resolveAgentExecutablePathOverride(agentSettings, provider)
          const env = resolveAgentLaunchEnv(agentSettings, provider)
          const anchorSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)
          const mergedEnv =
            environmentVariables && Object.keys(environmentVariables).length > 0
              ? { ...env, ...environmentVariables }
              : env
          let resolvedAnchorSpace = anchorSpace
          const shouldFallbackToFirstMount = !resolvedAnchorSpace && workspaceId.trim().length > 0

          let mountId: string | null = null
          let fallbackExecutionDirectory = workspacePath

          try {
            const resolvedMountContext = await resolveSpaceMountLaunchContext({
              workspaceId,
              workspacePath,
              space: resolvedAnchorSpace,
              spaces: spacesRef.current,
              onSpacesChange,
              onRequestPersistFlush,
              fallbackToFirstMount: shouldFallbackToFirstMount,
            })
            resolvedAnchorSpace = resolvedMountContext.space
            mountId = resolvedMountContext.mountId
            fallbackExecutionDirectory = resolvedMountContext.workingDirectory
          } catch (error) {
            onShowMessage?.(
              t('messages.mountListFailed', { message: toErrorMessage(error) }),
              'error',
            )
            return
          }

          let launchedSessionId = ''
          let launchedProfileId: string | null = null
          let launchedRuntimeKind: CreateNodeInput['runtimeKind'] = undefined
          let launchedEffectiveModel: string | null = null
          let executionDirectory = fallbackExecutionDirectory

          if (mountId) {
            const spawnCwdUri =
              fallbackExecutionDirectory.trim().length > 0
                ? toFileUri(fallbackExecutionDirectory.trim())
                : null

            const launched =
              await window.opencoveApi.controlSurface.invoke<LaunchAgentSessionResult>({
                kind: 'command',
                id: 'session.launchAgentInMount',
                payload: {
                  mountId,
                  cwdUri: spawnCwdUri,
                  prompt: '',
                  provider,
                  mode: 'new',
                  model,
                  ...(executablePathOverride ? { executablePathOverride } : {}),
                  ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
                  agentFullAccess: agentSettings.agentFullAccess,
                  cols: launchGeometry.terminalGeometry.cols,
                  rows: launchGeometry.terminalGeometry.rows,
                },
              })

            launchedSessionId = launched.sessionId
            launchedProfileId = launched.profileId
            launchedRuntimeKind = launched.runtimeKind ?? undefined
            launchedEffectiveModel = launched.effectiveModel
            executionDirectory = launched.executionContext.workingDirectory
          } else {
            const launched = await window.opencoveApi.agent.launch({
              provider,
              cwd: fallbackExecutionDirectory,
              profileId: agentSettings.defaultTerminalProfileId,
              prompt: '',
              mode: 'new',
              model,
              ...(executablePathOverride ? { executablePathOverride } : {}),
              ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
              agentFullAccess: agentSettings.agentFullAccess,
              cols: launchGeometry.terminalGeometry.cols,
              rows: launchGeometry.terminalGeometry.rows,
            })

            launchedSessionId = launched.sessionId
            launchedProfileId = launched.profileId ?? null
            launchedRuntimeKind = launched.runtimeKind
            launchedEffectiveModel = launched.effectiveModel
          }

          const modelLabel = launchedEffectiveModel ?? model

          const created = await createNodeForSession({
            sessionId: launchedSessionId,
            profileId: launchedProfileId,
            runtimeKind: launchedRuntimeKind,
            terminalGeometry: launchGeometry.terminalGeometry,
            title: buildAgentNodeTitle(provider, modelLabel),
            anchor,
            kind: 'agent',
            placement: {
              targetSpaceRect: resolvedAnchorSpace?.rect ?? null,
            },
            agent: {
              provider,
              prompt: '',
              model,
              effectiveModel: launchedEffectiveModel,
              launchMode: 'new',
              ...clearResumeSessionBinding(),
              executionDirectory,
              expectedDirectory: executionDirectory,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
              taskId: null,
            },
          })

          if (!created) {
            return
          }

          if (!resolvedAnchorSpace) {
            return
          }

          assignNodeToSpaceAndExpand({
            createdNodeId: created.id,
            targetSpaceId: resolvedAnchorSpace.id,
            spacesRef,
            nodesRef,
            setNodes,
            onSpacesChange,
          })

          onRequestPersistFlush?.()
        } catch (error) {
          onShowMessage?.(
            t('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
            'error',
          )
        }
      })()
    },
    [
      agentSettings,
      buildAgentNodeTitle,
      contextMenu,
      createNodeForSession,
      environmentVariables,
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      t,
      workspaceId,
      workspacePath,
    ],
  )

  const openAgentLauncher = useCallback(() => {
    openAgentLauncherForProvider(agentSettings.defaultProvider)
  }, [agentSettings.defaultProvider, openAgentLauncherForProvider])

  return {
    openAgentLauncher,
    openAgentLauncherForProvider,
  }
}
