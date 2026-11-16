import { useCallback, useLayoutEffect } from 'react'
import { resolvePaneNodeCreationAnchor } from './useInteractions.creationAnchor'
import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { TerminalPtyGeometryDisplayMetrics } from '@contexts/workspace/domain/terminalPtyGeometry'
import type { Point } from '../../../types'
import type { TerminalNodeData } from '../../../types'
import type { CreateNodeInput } from '../types'
import { createTerminalNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { bindWorkspaceCanvasCreateTerminalAtFlowPointTestAction } from '../testHarness'
import {
  useCanvasDocumentCommands,
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

export function useWorkspaceCanvasTerminalCreation({
  workspaceId,
  workspacePath,
  environmentVariables,
  defaultTerminalProfileId,
  standardWindowSizeBucket,
  terminalFontSize,
  terminalDisplayMetrics,
  createNodeForSession,
  updateCanvasDocument,
  onShowMessage,
}: {
  workspaceId: string
  workspacePath: string
  environmentVariables?: Record<string, string>
  defaultTerminalProfileId: string | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  terminalFontSize: number
  terminalDisplayMetrics: TerminalPtyGeometryDisplayMetrics
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  onShowMessage?: (message: string, level: 'info' | 'warning' | 'error') => void
}): {
  createTerminalNode: () => Promise<void>
  createTerminalNodeAtFlowPoint: (anchor: Point) => Promise<void>
} {
  const ui = useCanvasUiCommands()
  const documentCommands = useCanvasDocumentCommands()
  const readDocument = useReadCanvasDocument()
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
        readDocument,
        updateCanvasDocument,
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
      onShowMessage,
      readDocument,
      ui,
      standardWindowSizeBucket,
      terminalFontSize,
      terminalDisplayMetrics,
      updateCanvasDocument,
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
