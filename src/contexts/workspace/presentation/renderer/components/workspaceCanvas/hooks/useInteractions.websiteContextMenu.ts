import { useCallback } from 'react'
import { createWebsiteNodeFromPaneContextMenu } from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import { useCanvasUiCommands, useReadCanvasUi } from '../../../store/canvasStoreContext'

type WebsiteContextMenuParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
  | 'browserDefaultMode'
  | 'createWebsiteNode'
  | 'spacesRef'
  | 'standardWindowSizeBucket'
  | 'updateCanvasDocument'
  | 'websiteWindowsEnabled'
>

export function useWebsiteNodeContextMenuCreation({
  workspaceId,
  browserDefaultMode,
  createWebsiteNode,
  spacesRef,
  standardWindowSizeBucket,
  updateCanvasDocument,
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
      spacesRef,
      standardWindowSizeBucket,
      updateCanvasDocument,
      url: '',
    })
  }, [
    workspaceId,
    browserDefaultMode,
    createWebsiteNode,
    readUi,
    ui,
    spacesRef,
    standardWindowSizeBucket,
    updateCanvasDocument,
    websiteWindowsEnabled,
  ])
}
