import { useCallback } from 'react'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { BrowserMode } from '@shared/contracts/dto'
import type {
  ImageNodeData,
  TerminalNodeData,
  WebsiteNodeData,
  WorkspaceSpaceState,
} from '../../../types'
import type { NodeCreationPlacementOptions, ShowWorkspaceCanvasMessage } from '../types'
import { isEditableDomTarget } from '../domTargets'
import { resolveWebsitePasteUrl } from '@shared/utils/websiteUrl'
import { useWorkspaceCanvasImageImport } from './useCanvasImageImport'
import { createWebsiteNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import type { UpdateCanvasDocument } from './useNodesStore.types'

export function useWorkspaceCanvasPasteHandlers({
  workspaceId,
  canvasRef,
  reactFlow,
  updateCanvasDocument,
  onShowMessage,
  createImageNode,
  createWebsiteNode,
  standardWindowSizeBucket,
  browserDefaultMode,
  websiteWindowsEnabled,
  websiteWindowPasteEnabled,
}: {
  workspaceId?: string
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  updateCanvasDocument: UpdateCanvasDocument
  onShowMessage?: ShowWorkspaceCanvasMessage
  createImageNode: (
    anchor: { x: number; y: number },
    image: ImageNodeData,
    placement?: NodeCreationPlacementOptions,
  ) => Node<TerminalNodeData> | null
  createWebsiteNode: (
    anchor: { x: number; y: number },
    website: WebsiteNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  browserDefaultMode: BrowserMode
  websiteWindowsEnabled: boolean
  websiteWindowPasteEnabled: boolean
}): {
  handleCanvasPaste: React.ClipboardEventHandler<HTMLDivElement>
  handleCanvasDragOver: React.DragEventHandler<HTMLDivElement>
  handleCanvasDrop: React.DragEventHandler<HTMLDivElement>
} {
  const readDocument = useReadCanvasDocument()
  const imageImport = useWorkspaceCanvasImageImport({
    workspaceId,
    canvasRef,
    reactFlow,
    updateCanvasDocument,
    onShowMessage,
    createImageNode,
    standardWindowSizeBucket,
  })

  const handleCanvasPaste = useCallback<React.ClipboardEventHandler<HTMLDivElement>>(
    event => {
      imageImport.handleCanvasPaste(event)
      if (event.defaultPrevented) {
        return
      }

      if (isEditableDomTarget(event.target)) {
        return
      }

      if (!websiteWindowsEnabled || !websiteWindowPasteEnabled) {
        return
      }

      const text = event.clipboardData?.getData('text/plain') ?? ''
      const resolved = resolveWebsitePasteUrl(text)
      if (!resolved.url) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const flowCenter = reactFlow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })

      createWebsiteNodeAtFlowPosition({
        workspaceId,
        anchor: flowCenter,
        url: resolved.url,
        standardWindowSizeBucket,
        browserDefaultMode,
        createWebsiteNode,
        readDocument,
        updateCanvasDocument,
      })
    },
    [
      workspaceId,
      createWebsiteNode,
      imageImport,
      reactFlow,
      readDocument,
      standardWindowSizeBucket,
      browserDefaultMode,
      updateCanvasDocument,
      websiteWindowPasteEnabled,
      websiteWindowsEnabled,
    ],
  )

  return {
    handleCanvasPaste,
    handleCanvasDragOver: imageImport.handleCanvasDragOver,
    handleCanvasDrop: imageImport.handleCanvasDrop,
  }
}
