import { useCallback, useLayoutEffect, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { Point } from '../../../types'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState, CreateNodeInput } from '../types'
import { createTerminalNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import { bindWorkspaceCanvasCreateTerminalAtFlowPointTestAction } from '../testHarness'

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
  const createTerminalAtFlowPoint = useCallback(
    async (anchor: Point) => {
      setContextMenu(null)
      await createTerminalNodeAtFlowPosition({
        anchor,
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
    },
    [
      createNodeForSession,
      defaultTerminalProfileId,
      environmentVariables,
      nodesRef,
      onSpacesChange,
      onShowMessage,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      terminalFontSize,
      workspaceId,
      workspacePath,
    ],
  )

  useLayoutEffect(() => {
    if (window.opencoveApi?.meta?.isTest !== true) {
      return
    }

    bindWorkspaceCanvasCreateTerminalAtFlowPointTestAction(createTerminalAtFlowPoint)
    return () => {
      bindWorkspaceCanvasCreateTerminalAtFlowPointTestAction(null)
    }
  }, [createTerminalAtFlowPoint])

  return useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    await createTerminalAtFlowPoint({
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    })
  }, [contextMenu, createTerminalAtFlowPoint])
}
