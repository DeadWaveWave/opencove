import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { AgentSettings } from '@contexts/settings/domain/agentSettings'
import type { NodeLabelColorOverride } from '@shared/types/labelColor'
import { useTerminalClientDisplayCalibration } from '@contexts/settings/presentation/renderer/terminalDisplayCalibrationStorage'
import { resolveTerminalDisplayCalibrationCompensation } from '@contexts/settings/domain/terminalDisplayCalibration'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { WorkspaceCanvasActionRefs } from './useActionRefs'
import { useWorkspaceCanvasSelectNode } from './useSelectNode'
import { useWorkspaceCanvasNodeTypes } from '../nodeTypes'

export function useWorkspaceCanvasComposedNodeTypes({
  setNodes,
  setSelectedNodeIds,
  setSelectedSpaceIds,
  selectedNodeIdsRef,
  selectedSpaceIdsRef,
  spacesRef,
  workspacePath,
  onShowMessage,
  agentSettings,
  actionRefs,
  convertNoteToTask,
  setNodeLabelColorOverride,
}: {
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  selectedNodeIdsRef: MutableRefObject<string[]>
  selectedSpaceIdsRef: MutableRefObject<string[]>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  onShowMessage?: Parameters<typeof useWorkspaceCanvasNodeTypes>[0]['onShowMessage']
  agentSettings: AgentSettings
  actionRefs: WorkspaceCanvasActionRefs
  convertNoteToTask: (nodeId: string) => boolean
  setNodeLabelColorOverride: (nodeIds: string[], labelColorOverride: NodeLabelColorOverride) => void
}) {
  const savedTerminalDisplayCalibration = useTerminalClientDisplayCalibration({
    terminalFontSize: agentSettings.terminalFontSize,
    terminalFontFamily: agentSettings.terminalFontFamily,
    terminalDisplayReference: agentSettings.terminalDisplayReference,
  })
  const terminalDisplayCalibration = resolveTerminalDisplayCalibrationCompensation({
    calibration: savedTerminalDisplayCalibration,
    compensationEnabled: agentSettings.terminalDisplayCalibrationCompensationEnabled,
  })
  const selectNode: (nodeId: string, options?: { toggle?: boolean }) => void =
    useWorkspaceCanvasSelectNode({
      setNodes,
      setSelectedNodeIds,
      setSelectedSpaceIds,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      spacesRef,
    })

  return useWorkspaceCanvasNodeTypes({
    spacesRef,
    workspacePath,
    onShowMessage,
    terminalFontSize: agentSettings.terminalFontSize,
    terminalFontFamily: agentSettings.terminalFontFamily,
    terminalDisplayCalibration,
    agentProviderOrder: agentSettings.agentProviderOrder,
    defaultProvider: agentSettings.defaultProvider,
    browserDefaultMode: agentSettings.browserDefaultMode,
    browserSearchEngine: agentSettings.browserSearchEngine,
    selectNode,
    convertNoteToTask,
    setNodeLabelColorOverride,
    ...actionRefs,
  })
}
