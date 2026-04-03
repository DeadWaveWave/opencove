import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type {
  ImageNodeData,
  TerminalNodeData,
  WebsiteNodeData,
  WorkspaceSpaceState,
} from '../../../types'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { isEditableDomTarget } from '../domTargets'
import { resolveWebsitePasteUrl } from '@shared/utils/websiteUrl'
import { useWorkspaceCanvasImageImport } from './useCanvasImageImport'
import { createWebsiteNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import type { SetNodes } from './useInteractions.types'

export function useWorkspaceCanvasPasteHandlers({
  canvasRef,
  reactFlow,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onShowMessage,
  createImageNode,
  createWebsiteNode,
  standardWindowSizeBucket,
  websiteWindowsEnabled,
  websiteWindowPasteEnabled,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  createImageNode: (
    anchor: { x: number; y: number },
    image: ImageNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
  createWebsiteNode: (
    anchor: { x: number; y: number },
    website: WebsiteNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  websiteWindowsEnabled: boolean
  websiteWindowPasteEnabled: boolean
}): {
  handleCanvasPaste: React.ClipboardEventHandler<HTMLDivElement>
  handleCanvasDragOver: React.DragEventHandler<HTMLDivElement>
  handleCanvasDrop: React.DragEventHandler<HTMLDivElement>
} {
  const imageImport = useWorkspaceCanvasImageImport({
    canvasRef,
    reactFlow,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    onShowMessage,
    createImageNode,
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
        anchor: flowCenter,
        url: resolved.url,
        standardWindowSizeBucket,
        createWebsiteNode,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
      })
    },
    [
      createWebsiteNode,
      imageImport,
      nodesRef,
      onSpacesChange,
      reactFlow,
      setNodes,
      spacesRef,
      standardWindowSizeBucket,
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
