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
  spacesRef,
  workspacePath,
  defaultTerminalProfileId,
  nodesRef,
  standardWindowSizeBucket,
  createNodeForSession,
  setNodes,
  onSpacesChange,
}: {
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  defaultTerminalProfileId: string | null
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
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
      defaultTerminalProfileId,
      standardWindowSizeBucket,
      workspacePath,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
      createNodeForSession,
    })
  }, [
    contextMenu,
    createNodeForSession,
    nodesRef,
    onSpacesChange,
    setContextMenu,
    setNodes,
    spacesRef,
    defaultTerminalProfileId,
    standardWindowSizeBucket,
    workspacePath,
  ])
}
