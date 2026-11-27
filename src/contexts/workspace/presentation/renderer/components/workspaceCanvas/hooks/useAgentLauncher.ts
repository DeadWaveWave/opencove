import { useCallback, useRef } from 'react'
import { resolvePaneNodeCreationAnchor } from './useInteractions.creationAnchor'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveAgentModel,
  resolveSelectableAgentProvider,
} from '@contexts/settings/domain/agentSettings'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { AgentNodeData, Point, TerminalNodeData } from '../../../types'
import { resolveLaunchedAgentResumeBinding } from '../../../utils/agentResumeBinding'
import { resolveNodePlacementAnchorFromViewportCenter, toErrorMessage } from '../helpers'
import type { CreateNodeInput, ShowWorkspaceCanvasMessage, WorkspaceCanvasProps } from '../types'
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
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import {
  useCanvasDocumentCommands,
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

interface UseAgentLauncherParams {
  /** The settings a launch uses are read when it starts, never copied when this hook renders. */
  readAgentSettings: WorkspaceCanvasProps['readAgentSettings']
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  onShowMessage?: ShowWorkspaceCanvasMessage
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  buildAgentNodeTitle: (
    provider: AgentNodeData['provider'],
    effectiveModel: string | null,
  ) => string
}

export function useWorkspaceCanvasAgentLauncher({
  readAgentSettings,
  workspaceId,
  workspacePath,
  environmentVariables,
  updateCanvasDocument,
  onShowMessage,
  createNodeForSession,
  buildAgentNodeTitle,
}: UseAgentLauncherParams): {
  openAgentLauncher: () => void
  openAgentLauncherForProvider: (provider: AgentNodeData['provider']) => void
  launchAgentAtFlowPosition: (
    cursorAnchor: Point,
    provider?: AgentNodeData['provider'],
  ) => Promise<void>
} {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()
  const documentCommands = useCanvasDocumentCommands()
  const readDocument = useReadCanvasDocument()
  const { t } = useTranslation()
  const launching = useRef(false)

  const launchAgentAtFlowPosition = useCallback(
    async (cursorAnchor: Point, requestedProvider?: AgentNodeData['provider']): Promise<void> => {
      // The keyboard and menu share one launch transaction. Repeated input while
      // resolving a mount or starting its session must not create extra Agents.
      if (launching.current) {
        return
      }
      launching.current = true
      try {
        const agentSettings = readAgentSettings()
        const provider = resolveSelectableAgentProvider(
          requestedProvider ?? agentSettings.defaultProvider,
        )
        const launchGeometry = resolveDefaultAgentLaunchGeometry({
          bucket: agentSettings.standardWindowSizeBucket,
          provider,
          terminalFontSize: agentSettings.terminalFontSize,
        })
        const anchor = resolveNodePlacementAnchorFromViewportCenter(
          cursorAnchor,
          launchGeometry.frameSize,
        )
        const model = resolveAgentModel(agentSettings, provider)
        const executablePathOverride = resolveAgentExecutableOverride(agentSettings, provider)
        const anchorSpace = findContainingSpaceByAnchor(readDocument().spaces, cursorAnchor)
        const mergedEnv = buildMergedAgentLaunchEnv(agentSettings, provider, environmentVariables)
        let initialBinding: Awaited<ReturnType<typeof resolveWorkspaceAgentLaunchBinding>>
        try {
          initialBinding = await resolveWorkspaceAgentLaunchBinding({
            workspaceId,
            workspacePath,
            currentMountId: anchorSpace?.targetMountId ?? null,
            executionDirectory: resolveSpaceWorkingDirectory(anchorSpace, workspacePath),
            targetSpace: anchorSpace,
            updateSpaces: documentCommands.updateSpaces,
            mountQueryFailurePolicy: anchorSpace ? 'ignore' : 'throw',
          })
        } catch (error) {
          onShowMessage?.(
            t('messages.mountListFailed', { message: toErrorMessage(error) }),
            'error',
          )
          return
        }
        const canvasNodeId = crypto.randomUUID()
        const launched = await launchWorkspaceAgentSession({
          canvasNodeId,
          workspaceId: workspaceId,
          spaceId: anchorSpace?.id,
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
              updateSpaces: documentCommands.updateSpaces,
              mountQueryFailurePolicy: anchorSpace ? 'ignore' : 'throw',
            })
            return nextBinding.mountId && nextBinding.mountId !== failedMountId ? nextBinding : null
          },
        })

        const modelLabel = launched.effectiveModel ?? model

        const created = await createNodeForSession({
          nodeId: canvasNodeId,
          sessionId: launched.sessionId,
          ...(launched.managedClaudeLifecycle
            ? { managedClaudeLifecycle: launched.managedClaudeLifecycle }
            : {}),
          profileId: launched.profileId,
          runtimeKind: launched.runtimeKind as CreateNodeInput['runtimeKind'],
          terminalGeometry: launchGeometry.terminalGeometry,
          standardWindowSizeBucket: agentSettings.standardWindowSizeBucket,
          workerBinding: launched.workerBinding,
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
            ...resolveLaunchedAgentResumeBinding(provider, 'new', launched.resumeSessionId),
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
          workspaceId,
          createdNodeId: created.id,
          targetSpaceId: anchorSpace.id,
          targetSpaceSnapshot: anchorSpace,
          updateCanvasDocument,
        })

        // The assignment is one write of the nodes and the Spaces; the flush follows it.
        documentCommands.requestPersistFlush()
      } catch (error) {
        onShowMessage?.(
          t('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
          'error',
        )
      } finally {
        launching.current = false
      }
    },
    [
      buildAgentNodeTitle,
      createNodeForSession,
      documentCommands,
      environmentVariables,
      onShowMessage,
      readAgentSettings,
      readDocument,
      t,
      updateCanvasDocument,
      workspaceId,
      workspacePath,
    ],
  )

  const openAgentLauncherForProvider = useCallback(
    (provider: AgentNodeData['provider']) => {
      const contextMenu = readUi().contextMenu
      if (!contextMenu || contextMenu.kind !== 'pane') {
        return
      }
      const anchor = resolvePaneNodeCreationAnchor(contextMenu)
      ui.closeContextMenu()
      void launchAgentAtFlowPosition(anchor, provider)
    },
    [launchAgentAtFlowPosition, readUi, ui],
  )

  const openAgentLauncher = useCallback(() => {
    openAgentLauncherForProvider(
      resolveSelectableAgentProvider(readAgentSettings().defaultProvider),
    )
  }, [openAgentLauncherForProvider, readAgentSettings])

  return {
    openAgentLauncher,
    openAgentLauncherForProvider,
    launchAgentAtFlowPosition,
  }
}
