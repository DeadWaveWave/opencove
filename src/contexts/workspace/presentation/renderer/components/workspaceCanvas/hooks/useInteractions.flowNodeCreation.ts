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
  | 'nodesRef'
  | 'setNodes'
  | 'onSpacesChange'
>

export function useWorkspaceCanvasFlowNodeCreation({
  workspaceId,
  standardWindowSizeBucket,
  createNoteNode,
  createWebsiteNode,
  browserDefaultMode,
  websiteWindowsEnabled,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
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
        nodesRef,
        setNodes,
        onSpacesChange,
      })
    },
    [
      createNoteNode,
      nodesRef,
      onSpacesChange,
      ui,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      workspaceId,
    ],
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
        nodesRef,
        setNodes,
        onSpacesChange,
      })
    },
    [
      browserDefaultMode,
      createWebsiteNode,
      nodesRef,
      onSpacesChange,
      ui,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
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
      nodesRef,
      setNodes,
      onSpacesChange,
    })
  }, [
    workspaceId,
    createNoteNode,
    nodesRef,
    onSpacesChange,
    readUi,
    ui,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
  ])

  return { createNoteNodeAtFlowPoint, createWebsiteNodeAtFlowPoint, createNoteNodeFromContextMenu }
}
