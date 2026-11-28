import { useCallback } from 'react'
import { createWebsiteNodeFromPaneContextMenu } from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'
import { useCanvasNodeWriter } from './useCanvasNodeWriter'
import {
  useCanvasUiCommands,
  useReadCanvasDocument,
  useReadCanvasUi,
} from '../../../store/canvasStoreContext'

type WebsiteContextMenuParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
  | 'browserDefaultMode'
  | 'createWebsiteNode'
  | 'standardWindowSizeBucket'
  | 'websiteWindowsEnabled'
>

export function useWebsiteNodeContextMenuCreation({
  workspaceId,
  browserDefaultMode,
  createWebsiteNode,
  standardWindowSizeBucket,
  websiteWindowsEnabled,
}: WebsiteContextMenuParams): () => void {
  const { updateCanvasDocument } = useCanvasNodeWriter()
  const ui = useCanvasUiCommands()
  const readDocument = useReadCanvasDocument()
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
      readDocument,
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
    readDocument,
    standardWindowSizeBucket,
    updateCanvasDocument,
    websiteWindowsEnabled,
  ])
}
