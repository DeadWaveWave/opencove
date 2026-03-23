import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
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
  defaultTerminalWindowScalePercent,
  spacesRef,
  workspacePath,
  defaultTerminalProfileId,
  nodesRef,
  createNodeForSession,
  setNodes,
  onSpacesChange,
}: {
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  defaultTerminalWindowScalePercent: number
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  defaultTerminalProfileId: string | null
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
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
      defaultTerminalWindowScalePercent,
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
    defaultTerminalWindowScalePercent,
    workspacePath,
  ])
}
