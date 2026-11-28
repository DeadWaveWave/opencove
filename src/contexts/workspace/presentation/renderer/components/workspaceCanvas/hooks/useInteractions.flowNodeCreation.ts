import { useCallback } from 'react'
import type { Point } from '../../../types'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import {
  createNoteNodeAtFlowPosition,
  createNoteNodeFromPaneContextMenu,
  createWebsiteNodeAtFlowPosition,
} from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import {
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

type FlowNodeCreationParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
  | 'standardWindowSizeBucket'
  | 'createNoteNode'
  | 'createWebsiteNode'
  | 'browserDefaultMode'
  | 'websiteWindowsEnabled'
>

export function useWorkspaceCanvasFlowNodeCreation({
  workspaceId,
  standardWindowSizeBucket,
  createNoteNode,
  createWebsiteNode,
  browserDefaultMode,
  websiteWindowsEnabled,
}: FlowNodeCreationParams) {
  const { updateCanvasDocument } = useCanvasNodeWriter()
  const ui = useCanvasUiCommands()
  const readDocument = useReadCanvasDocument()
  const readUi = useReadCanvasUi()

  const createNoteNodeAtFlowPoint = useCallback(
    (anchor: Point): void => {
      ui.closeContextMenu()
      ui.cancelSpaceRename()
      createNoteNodeAtFlowPosition({
        workspaceId,
        anchor,
        standardWindowSizeBucket,
        createNoteNode,
        readDocument,
        updateCanvasDocument,
      })
    },
    [createNoteNode, ui, readDocument, standardWindowSizeBucket, updateCanvasDocument, workspaceId],
  )
  const createWebsiteNodeAtFlowPoint = useCallback(
    (anchor: Point): void => {
      if (!websiteWindowsEnabled) {
        return
      }

      ui.closeContextMenu()
      ui.cancelSpaceRename()
      createWebsiteNodeAtFlowPosition({
        workspaceId,
        anchor,
        standardWindowSizeBucket,
        browserDefaultMode,
        url: '',
        createWebsiteNode,
        readDocument,
        updateCanvasDocument,
      })
    },
    [
      browserDefaultMode,
      createWebsiteNode,
      ui,
      readDocument,
      standardWindowSizeBucket,
      updateCanvasDocument,
      websiteWindowsEnabled,
      workspaceId,
    ],
  )
  const createNoteNodeFromContextMenu = useCallback(() => {
    createNoteNodeFromPaneContextMenu({
      workspaceId,
      contextMenu: readUi().contextMenu,
      ui,
      createNoteNode,
      standardWindowSizeBucket,
      readDocument,
      updateCanvasDocument,
    })
  }, [
    workspaceId,
    createNoteNode,
    readUi,
    ui,
    readDocument,
    standardWindowSizeBucket,
    updateCanvasDocument,
  ])

  return { createNoteNodeAtFlowPoint, createWebsiteNodeAtFlowPoint, createNoteNodeFromContextMenu }
}
