import { useCallback } from 'react'
import { createWebsiteNodeFromPaneContextMenu } from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import { useCanvasUiCommands, useReadCanvasUi } from '../../../store/canvasStoreContext'

type WebsiteContextMenuParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
  | 'browserDefaultMode'
  | 'createWebsiteNode'
  | 'nodesRef'
  | 'onSpacesChange'
  | 'setNodes'
  | 'spacesRef'
  | 'standardWindowSizeBucket'
  | 'websiteWindowsEnabled'
>

export function useWebsiteNodeContextMenuCreation({
  workspaceId,
  browserDefaultMode,
  createWebsiteNode,
  nodesRef,
  onSpacesChange,
  setNodes,
  spacesRef,
  standardWindowSizeBucket,
  websiteWindowsEnabled,
}: WebsiteContextMenuParams): () => void {
  const ui = useCanvasUiCommands()
  const readUi = useReadCanvasUi()

  return useCallback(() => {
    if (!websiteWindowsEnabled) {
      return
    }

    createWebsiteNodeFromPaneContextMenu({
      workspaceId,
      browserDefaultMode,
      contextMenu: readUi().contextMenu,
      ui,
      createWebsiteNode,
      nodesRef,
      onSpacesChange,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      url: '',
    })
  }, [
    workspaceId,
    browserDefaultMode,
    createWebsiteNode,
    nodesRef,
    onSpacesChange,
    readUi,
    ui,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
    websiteWindowsEnabled,
  ])
}
