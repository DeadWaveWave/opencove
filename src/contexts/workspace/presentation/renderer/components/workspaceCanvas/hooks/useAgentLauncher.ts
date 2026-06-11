import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveAgentModel,
  type AgentSettings,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { AgentNodeData, Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { resolveNodePlacementAnchorFromViewportCenter, toErrorMessage } from '../helpers'
import type { ContextMenuState, CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'
import { resolveDefaultAgentLaunchGeometry } from './agentLaunchGeometry'
import {
  buildMergedAgentLaunchEnv,
  launchWorkspaceAgentSession,
  resolveAgentExecutableOverride,
  resolveWorkspaceAgentLaunchBinding,
} from './useWorkspaceAgentLaunch.shared'

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
          const executablePathOverride = resolveAgentExecutableOverride(agentSettings, provider)
          const anchorSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)
          const mergedEnv = buildMergedAgentLaunchEnv(agentSettings, provider, environmentVariables)
          let initialBinding: Awaited<ReturnType<typeof resolveWorkspaceAgentLaunchBinding>>
          try {
            initialBinding = await resolveWorkspaceAgentLaunchBinding({
              workspaceId,
              workspacePath,
              currentMountId: anchorSpace?.targetMountId ?? null,
              executionDirectory: resolveSpaceWorkingDirectory(anchorSpace, workspacePath),
              targetSpace: anchorSpace,
              spacesRef,
              onSpacesChange,
              onRequestPersistFlush,
              mountQueryFailurePolicy: anchorSpace ? 'ignore' : 'throw',
            })
          } catch (error) {
            onShowMessage?.(
              t('messages.mountListFailed', { message: toErrorMessage(error) }),
              'error',
            )
            return
          }
          const launched = await launchWorkspaceAgentSession({
            mountId: initialBinding.mountId,
            workspacePath,
            executionDirectory: initialBinding.executionDirectory,
            prompt: '',
            provider,
            mode: 'new',
            model,
            executablePathOverride,
            mergedEnv,
            agentSettings,
            launchGeometry,
            retryResolveMountBinding: async failedMountId => {
              const nextBinding = await resolveWorkspaceAgentLaunchBinding({
                workspaceId,
                workspacePath,
                currentMountId: null,
                executionDirectory: initialBinding.executionDirectory,
                targetSpace: anchorSpace,
                spacesRef,
                onSpacesChange,
                onRequestPersistFlush,
                mountQueryFailurePolicy: anchorSpace ? 'ignore' : 'throw',
              })
              return nextBinding.mountId && nextBinding.mountId !== failedMountId
                ? nextBinding
                : null
            },
          })

          const modelLabel = launched.effectiveModel ?? model

          const created = await createNodeForSession({
            sessionId: launched.sessionId,
            profileId: launched.profileId,
            runtimeKind: launched.runtimeKind as CreateNodeInput['runtimeKind'],
            terminalGeometry: launchGeometry.terminalGeometry,
            title: buildAgentNodeTitle(provider, modelLabel),
            anchor,
            kind: 'agent',
            placement: {
              targetSpaceRect: anchorSpace?.rect ?? null,
            },
            agent: {
              provider,
              prompt: '',
              model,
              effectiveModel: launched.effectiveModel,
              launchMode: 'new',
              ...clearResumeSessionBinding(),
              executionDirectory: launched.executionDirectory,
              expectedDirectory: launched.executionDirectory,
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
              taskId: null,
            },
          })

          if (!created) {
            return
          }

          if (!anchorSpace) {
            return
          }

          assignNodeToSpaceAndExpand({
            createdNodeId: created.id,
            targetSpaceId: anchorSpace.id,
            targetSpaceSnapshot: anchorSpace,
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
