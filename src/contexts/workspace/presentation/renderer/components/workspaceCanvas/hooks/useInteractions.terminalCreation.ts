import { useCallback, useLayoutEffect, type MutableRefObject } from 'react'
import { resolvePaneNodeCreationAnchor } from './useInteractions.creationAnchor'
import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { TerminalPtyGeometryDisplayMetrics } from '@contexts/workspace/domain/terminalPtyGeometry'
import type { Point } from '../../../types'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { CreateNodeInput } from '../types'
import { createTerminalNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import { bindWorkspaceCanvasCreateTerminalAtFlowPointTestAction } from '../testHarness'
import {
  useCanvasDocumentCommands,
  useCanvasUiCommands,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useWorkspaceCanvasTerminalCreation({
  workspaceId,
  spacesRef,
  workspacePath,
  environmentVariables,
  defaultTerminalProfileId,
  nodesRef,
  standardWindowSizeBucket,
  terminalFontSize,
  terminalDisplayMetrics,
  createNodeForSession,
  setNodes,
  onSpacesChange,
  onShowMessage,
}: {
  workspaceId: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  environmentVariables?: Record<string, string>
  defaultTerminalProfileId: string | null
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  terminalFontSize: number
  terminalDisplayMetrics: TerminalPtyGeometryDisplayMetrics
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): {
  createTerminalNode: () => Promise<void>
  createTerminalNodeAtFlowPoint: (anchor: Point) => Promise<void>
} {
  const ui = useCanvasUiCommands()
  const documentCommands = useCanvasDocumentCommands()
  const readUi = useReadCanvasUi()

  const createTerminalAtFlowPoint = useCallback(
    async (anchor: Point) => {
      ui.closeContextMenu()
      await createTerminalNodeAtFlowPosition({
        anchor,
        workspaceId,
        defaultTerminalProfileId,
        standardWindowSizeBucket,
        terminalFontSize,
        terminalDisplayMetrics,
        workspacePath,
        environmentVariables,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
        updateSpaces: documentCommands.updateSpaces,
        createNodeForSession,
        onShowMessage,
      })
    },
    [
      createNodeForSession,
      defaultTerminalProfileId,
      documentCommands,
      environmentVariables,
      nodesRef,
      onSpacesChange,
      onShowMessage,
      ui,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      terminalFontSize,
      terminalDisplayMetrics,
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

  const createTerminalNode = useCallback(async () => {
    const contextMenu = readUi().contextMenu
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    await createTerminalAtFlowPoint(resolvePaneNodeCreationAnchor(contextMenu))
  }, [createTerminalAtFlowPoint, readUi])

  return {
    createTerminalNode,
    createTerminalNodeAtFlowPoint: createTerminalAtFlowPoint,
  }
}
