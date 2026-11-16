import { useCallback } from 'react'
import type { Point } from '../../../types'
import {
  createNoteNodeAtFlowPosition,
  createNoteNodeFromPaneContextMenu,
  createWebsiteNodeAtFlowPosition,
} from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import { useCanvasUiCommands, useReadCanvasUi } from '../../../store/canvasStoreContext'

type FlowNodeCreationParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
  | 'standardWindowSizeBucket'
  | 'createNoteNode'
  | 'createWebsiteNode'
  | 'browserDefaultMode'
  | 'websiteWindowsEnabled'
  | 'spacesRef'
  | 'updateCanvasDocument'
>

export function useWorkspaceCanvasFlowNodeCreation({
  workspaceId,
  standardWindowSizeBucket,
  createNoteNode,
  createWebsiteNode,
  browserDefaultMode,
  websiteWindowsEnabled,
  spacesRef,
  updateCanvasDocument,
}: FlowNodeCreationParams) {
  const ui = useCanvasUiCommands()
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
        spacesRef,
        updateCanvasDocument,
      })
    },
    [createNoteNode, ui, spacesRef, standardWindowSizeBucket, updateCanvasDocument, workspaceId],
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
        spacesRef,
        updateCanvasDocument,
      })
    },
    [
      browserDefaultMode,
      createWebsiteNode,
      ui,
      spacesRef,
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
      spacesRef,
      updateCanvasDocument,
    })
  }, [
    workspaceId,
    createNoteNode,
    readUi,
    ui,
    spacesRef,
    standardWindowSizeBucket,
    updateCanvasDocument,
  ])

  return { createNoteNodeAtFlowPoint, createWebsiteNodeAtFlowPoint, createNoteNodeFromContextMenu }
}
