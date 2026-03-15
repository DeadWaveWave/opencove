import { useCallback } from 'react'
import type { Node } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveAgentModel, type AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { AgentNodeData, Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { clearResumeSessionBinding } from '../../../utils/agentResumeBinding'
import { sanitizeSpaces, toErrorMessage } from '../helpers'
import type { ContextMenuState, CreateNodeInput, ShowWorkspaceCanvasMessage } from '../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'

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
  buildAgentNodeTitle,
}: UseAgentLauncherParams): {
  openAgentLauncher: () => void
} {
  const { t } = useTranslation()

  const openAgentLauncher = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    const anchor: Point = {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    }

    const provider = agentSettings.defaultProvider
    const model = resolveAgentModel(agentSettings, provider)

    const anchorSpace =
      spacesRef.current.find(space => {
        if (!space.rect) {
          return false
        }

        return (
          anchor.x >= space.rect.x &&
          anchor.x <= space.rect.x + space.rect.width &&
          anchor.y >= space.rect.y &&
          anchor.y <= space.rect.y + space.rect.height
        )
      }) ?? null

    const executionDirectory =
      anchorSpace && anchorSpace.directoryPath.trim().length > 0
        ? anchorSpace.directoryPath
        : workspacePath

    setContextMenu(null)

    void (async () => {
      try {
        const launched = await window.opencoveApi.agent.launch({
          provider,
          cwd: executionDirectory,
          prompt: '',
          mode: 'new',
          model,
          agentFullAccess: agentSettings.agentFullAccess,
          cols: 80,
          rows: 24,
        })

        const modelLabel = launched.effectiveModel ?? model
        const created = await createNodeForSession({
          sessionId: launched.sessionId,
          title: buildAgentNodeTitle(provider, modelLabel),
          anchor,
          kind: 'agent',
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

        const nextSpaces = sanitizeSpaces(
          spacesRef.current.map(space => {
            const filtered = space.nodeIds.filter(nodeId => nodeId !== created.id)

            if (space.id !== anchorSpace.id) {
              return {
                ...space,
                nodeIds: filtered,
              }
            }

            return {
              ...space,
              nodeIds: [...new Set([...filtered, created.id])],
            }
          }),
        )

        const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
          targetSpaceId: anchorSpace.id,
          spaces: nextSpaces,
          nodeRects: nodesRef.current.map(node => ({
            id: node.id,
            rect: {
              x: node.position.x,
              y: node.position.y,
              width: node.data.width,
              height: node.data.height,
            },
          })),
          gap: 0,
        })

        if (nodePositionById.size > 0) {
          setNodes(
            prevNodes => {
              let hasChanged = false
              const next = prevNodes.map(node => {
                const nextPosition = nodePositionById.get(node.id)
                if (!nextPosition) {
                  return node
                }

                if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  position: nextPosition,
                }
              })

              return hasChanged ? next : prevNodes
            },
            { syncLayout: false },
          )
        }

        onSpacesChange(pushedSpaces)
        onRequestPersistFlush?.()
      } catch (error) {
        onShowMessage?.(
          t('messages.agentLaunchFailed', { message: toErrorMessage(error) }),
          'error',
        )
      }
    })()
  }, [
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
    t,
    workspacePath,
  ])

  return {
    openAgentLauncher,
  }
}
