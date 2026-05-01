import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState, CreateNodeInput } from '../types'
import { createTerminalNodeAtFlowPosition } from './useInteractions.paneNodeCreation'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useWorkspaceCanvasTerminalCreation({
  contextMenu,
  setContextMenu,
  workspaceId,
  spacesRef,
  workspacePath,
  environmentVariables,
  defaultTerminalProfileId,
  nodesRef,
  standardWindowSizeBucket,
  terminalFontSize,
  createNodeForSession,
  setNodes,
  onSpacesChange,
  onShowMessage,
}: {
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  workspaceId: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  environmentVariables?: Record<string, string>
  defaultTerminalProfileId: string | null
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  terminalFontSize: number
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): () => Promise<void> {
  return useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    setContextMenu(null)
    await createTerminalNodeAtFlowPosition({
      anchor: {
        x: contextMenu.flowX,
        y: contextMenu.flowY,
      },
      workspaceId,
      defaultTerminalProfileId,
      standardWindowSizeBucket,
      terminalFontSize,
      workspacePath,
      environmentVariables,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
      createNodeForSession,
      onShowMessage,
    })
  }, [
    contextMenu,
    createNodeForSession,
    environmentVariables,
    nodesRef,
    onSpacesChange,
    setContextMenu,
    setNodes,
    spacesRef,
    defaultTerminalProfileId,
    standardWindowSizeBucket,
    terminalFontSize,
    workspacePath,
    workspaceId,
    onShowMessage,
  ])
}
