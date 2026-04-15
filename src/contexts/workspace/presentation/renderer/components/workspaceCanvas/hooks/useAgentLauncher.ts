import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveAgentModel,
  resolveAgentLaunchEnv,
  type AgentSettings,
  type StandardWindowSizeBucket,
} from '@contexts/settings/domain/agentSettings'
import { resolveSpaceWorkingDirectory } from '@contexts/space/application/resolveSpaceWorkingDirectory'
import type { AgentNodeData, Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { resolveDefaultAgentWindowSize } from '../constants'
import { resolveNodePlacementAnchorFromViewportCenter, toErrorMessage } from '../helpers'
import type { ContextMenuState, CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'

interface UseAgentLauncherParams {
  agentSettings: AgentSettings
  workspacePath: string
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
  workspacePath,
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
          const anchor = resolveNodePlacementAnchorFromViewportCenter(
            cursorAnchor,
            resolveDefaultAgentWindowSize(standardWindowSizeBucket),
          )
          const model = resolveAgentModel(agentSettings, provider)
          const env = resolveAgentLaunchEnv(agentSettings, provider)
          const anchorSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)
          const executionDirectory = resolveSpaceWorkingDirectory(anchorSpace, workspacePath)
          const launched = await window.opencoveApi.agent.launch({
            provider,
            cwd: executionDirectory,
            profileId: agentSettings.defaultTerminalProfileId,
            prompt: '',
            mode: 'new',
            model,
            ...(Object.keys(env).length > 0 ? { env } : {}),
            agentFullAccess: agentSettings.agentFullAccess,
            cols: 80,
            rows: 24,
          })

          const modelLabel = launched.effectiveModel ?? model
          const created = await createNodeForSession({
            sessionId: launched.sessionId,
            profileId: launched.profileId,
            runtimeKind: launched.runtimeKind,
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
              launchMode: launched.launchMode,
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

          if (!anchorSpace) {
            return
          }

          assignNodeToSpaceAndExpand({
            createdNodeId: created.id,
            targetSpaceId: anchorSpace.id,
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
      nodesRef,
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      t,
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
