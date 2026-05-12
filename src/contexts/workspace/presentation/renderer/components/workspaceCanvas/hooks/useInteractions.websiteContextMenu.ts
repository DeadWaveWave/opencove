import { useCallback } from 'react'
import { createWebsiteNodeFromPaneContextMenu } from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'

type WebsiteContextMenuParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'browserDefaultMode'
  | 'contextMenu'
  | 'createWebsiteNode'
  | 'nodesRef'
  | 'onSpacesChange'
  | 'setContextMenu'
  | 'setNodes'
  | 'spacesRef'
  | 'standardWindowSizeBucket'
  | 'websiteWindowsEnabled'
>

export function useWebsiteNodeContextMenuCreation({
  browserDefaultMode,
  contextMenu,
  createWebsiteNode,
  nodesRef,
  onSpacesChange,
  setContextMenu,
  setNodes,
  spacesRef,
  standardWindowSizeBucket,
  websiteWindowsEnabled,
}: WebsiteContextMenuParams): () => void {
  return useCallback(() => {
    if (!websiteWindowsEnabled) {
      return
    }

    createWebsiteNodeFromPaneContextMenu({
      browserDefaultMode,
      contextMenu,
      createWebsiteNode,
      nodesRef,
      onSpacesChange,
      setContextMenu,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
      url: '',
    })
  }, [
    browserDefaultMode,
    contextMenu,
    createWebsiteNode,
    nodesRef,
    onSpacesChange,
    setContextMenu,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
    websiteWindowsEnabled,
  ])
}
