import { useCallback } from 'react'
import { createWebsiteNodeFromPaneContextMenu } from './useInteractions.paneNodeCreation'
import type { UseWorkspaceCanvasInteractionsParams } from './useInteractions.types'

type WebsiteContextMenuParams = Pick<
  UseWorkspaceCanvasInteractionsParams,
  | 'workspaceId'
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
  workspaceId,
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
      workspaceId,
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
    workspaceId,
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
