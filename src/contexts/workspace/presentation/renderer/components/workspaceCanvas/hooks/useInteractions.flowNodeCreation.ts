import { useCallback } from 'react'
import type { Point } from '../../../types'
import {
  createNoteNodeAtFlowPosition,
  createNoteNodeFromPaneContextMenu,
  createWebsiteNodeAtFlowPosition,
} from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'

type FlowNodeCreationParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
  | 'contextMenu'
  | 'setContextMenu'
  | 'setEmptySelectionPrompt'
  | 'cancelSpaceRename'
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
  contextMenu,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
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
  const createNoteNodeAtFlowPoint = useCallback(
    (anchor: Point): void => {
      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
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
      cancelSpaceRename,
      createNoteNode,
      nodesRef,
      onSpacesChange,
      setContextMenu,
      setEmptySelectionPrompt,
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

      setContextMenu(null)
      setEmptySelectionPrompt(null)
      cancelSpaceRename()
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
      cancelSpaceRename,
      createWebsiteNode,
      nodesRef,
      onSpacesChange,
      setContextMenu,
      setEmptySelectionPrompt,
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
      contextMenu,
      createNoteNode,
      standardWindowSizeBucket,
      spacesRef,
      nodesRef,
      setNodes,
      onSpacesChange,
      setContextMenu,
    })
  }, [
    workspaceId,
    contextMenu,
    createNoteNode,
    nodesRef,
    onSpacesChange,
    setContextMenu,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
  ])

  return { createNoteNodeAtFlowPoint, createWebsiteNodeAtFlowPoint, createNoteNodeFromContextMenu }
}
