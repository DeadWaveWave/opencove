import { useMemo } from 'react'
import type { Node, Viewport } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import {
  AGENT_PROVIDER_LABEL,
  resolveTaskTitleModel,
  resolveTaskTitleProvider,
  type AgentSettings,
} from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData } from '../../../types'
import { useWorkspaceCanvasTaskAgentEdges } from './useTaskAgentEdges'
import { useWorkspaceCanvasViewportMoveEnd } from './useViewportMoveEnd'
import { useWorkspaceCanvasSpaceUi } from './useSpaceUi'
import { resolveWorkspaceMinimapNodeColor } from '../minimap'

export function useWorkspaceCanvasViewModel({
  agentSettings,
  onViewportChange,
  flowNodes,
  workspacePath,
  handlePaneClick,
  handlePaneContextMenu,
  handleNodeContextMenu,
  handleSelectionContextMenu,
}: {
  agentSettings: AgentSettings
  onViewportChange: (viewport: Viewport) => void
  flowNodes: Node<TerminalNodeData>[]
  workspacePath: string
  handlePaneClick: (event: React.MouseEvent | MouseEvent) => void
  handlePaneContextMenu: (event: React.MouseEvent | MouseEvent) => void
  handleNodeContextMenu: (event: React.MouseEvent, node: Node<TerminalNodeData>) => void
  handleSelectionContextMenu: (
    event: React.MouseEvent,
    selectedNodes: Node<TerminalNodeData>[],
  ) => void
}): {
  taskTitleProviderLabel: string
  taskTitleModelLabel: string
  handleViewportMoveEnd: (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => void
  minimapNodeColor: typeof resolveWorkspaceMinimapNodeColor
  taskAgentEdges: ReturnType<typeof useWorkspaceCanvasTaskAgentEdges>
  spaceUi: ReturnType<typeof useWorkspaceCanvasSpaceUi>
} {
  const { t } = useTranslation()
  const taskTitleProviderLabel = AGENT_PROVIDER_LABEL[resolveTaskTitleProvider(agentSettings)]
  const taskTitleModelLabel = resolveTaskTitleModel(agentSettings) ?? t('common.defaultModel')
  const handleViewportMoveEnd = useWorkspaceCanvasViewportMoveEnd({ onViewportChange })
  const minimapNodeColor = resolveWorkspaceMinimapNodeColor

  const taskAgentEdges = useWorkspaceCanvasTaskAgentEdges(flowNodes)

  const spaceUi = useWorkspaceCanvasSpaceUi({
    workspacePath,
    handlePaneClick,
    handlePaneContextMenu,
    handleNodeContextMenu,
    handleSelectionContextMenu,
  })

  return useMemo(
    () => ({
      taskTitleProviderLabel,
      taskTitleModelLabel,
      handleViewportMoveEnd,
      minimapNodeColor,
      taskAgentEdges,
      spaceUi,
    }),
    [
      handleViewportMoveEnd,
      minimapNodeColor,
      spaceUi,
      taskAgentEdges,
      taskTitleModelLabel,
      taskTitleProviderLabel,
    ],
  )
}
