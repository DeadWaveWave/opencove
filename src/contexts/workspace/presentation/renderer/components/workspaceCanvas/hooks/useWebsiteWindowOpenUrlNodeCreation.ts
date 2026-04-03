import { useEffect } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import {
  WEBSITE_WINDOW_OPEN_URL_EVENT_NAME,
  type WebsiteWindowOpenUrlEventDetail,
} from '@shared/contracts/websiteWindowCanvas'
import type { Point, TerminalNodeData, WebsiteNodeData, WorkspaceSpaceState } from '../../../types'
import { createWebsiteNodeAtFlowPosition } from './useInteractions.paneNodeCreation'
import type { SetNodes } from './useInteractions.types'

export function useWebsiteWindowOpenUrlNodeCreation({
  canvasRef,
  reactFlow,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  createWebsiteNode,
  standardWindowSizeBucket,
  enabled,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createWebsiteNode: (
    anchor: Point,
    website: WebsiteNodeData,
    placement?: { targetSpaceRect?: WorkspaceSpaceState['rect'] | null },
  ) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  enabled: boolean
}): void {
  useEffect(() => {
    if (!enabled) {
      return
    }

    const handleOpenUrl = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<WebsiteWindowOpenUrlEventDetail>
      const detail = event.detail
      if (!detail || detail.type !== 'open-url' || detail.url.trim().length === 0) {
        return
      }

      const sourceNode = nodesRef.current.find(node => node.id === detail.sourceNodeId) ?? null
      const fallbackRect = canvasRef.current?.getBoundingClientRect() ?? null
      const baseAnchor = sourceNode
        ? {
            x:
              sourceNode.position.x +
              ((sourceNode.width ?? 0) > 0 ? (sourceNode.width ?? 0) + 48 : 48),
            y:
              sourceNode.position.y +
              ((sourceNode.height ?? 0) > 0 ? (sourceNode.height ?? 0) / 2 : 0),
          }
        : fallbackRect
          ? reactFlow.screenToFlowPosition({
              x: fallbackRect.left + fallbackRect.width / 2,
              y: fallbackRect.top + fallbackRect.height / 2,
            })
          : reactFlow.screenToFlowPosition({
              x: window.innerWidth / 2,
              y: window.innerHeight / 2,
            })

      createWebsiteNodeAtFlowPosition({
        anchor: baseAnchor,
        url: detail.url,
        standardWindowSizeBucket,
        createWebsiteNode,
        spacesRef,
        nodesRef,
        setNodes,
        onSpacesChange,
      })
    }

    window.addEventListener(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, handleOpenUrl as EventListener)
    return () => {
      window.removeEventListener(WEBSITE_WINDOW_OPEN_URL_EVENT_NAME, handleOpenUrl as EventListener)
    }
  }, [
    canvasRef,
    createWebsiteNode,
    enabled,
    nodesRef,
    onSpacesChange,
    reactFlow,
    setNodes,
    spacesRef,
    standardWindowSizeBucket,
  ])
}
