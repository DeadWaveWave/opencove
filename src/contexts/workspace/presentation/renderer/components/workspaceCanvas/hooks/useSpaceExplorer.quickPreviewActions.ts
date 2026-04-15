import React from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'
import type { WorkspaceCanvasQuickPreviewState } from '../types'
import type { ExplorerPlacementPx } from './useSpaceExplorer.placement'
import type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession'

type ResolveQuickPreviewState = (
  spaceId: string,
  uri: string,
  options?: { explorerPlacementPx?: ExplorerPlacementPx },
) => Promise<WorkspaceCanvasQuickPreviewState | null>

type MaterializePreviewState = (
  preview: WorkspaceCanvasQuickPreviewState,
  options: {
    focusViewportOnCreate: boolean
    isRequestCurrent: () => boolean
    usePreviewRectAsAnchor?: boolean
  },
) => Promise<Node<TerminalNodeData> | null>

export function useWorkspaceCanvasSpaceExplorerQuickPreviewActions(options: {
  beginTransientRequest: () => number
  isTransientRequestCurrent: (sequence: number) => boolean
  resolveQuickPreviewState: ResolveQuickPreviewState
  materializePreviewState: MaterializePreviewState
  quickPreview: WorkspaceCanvasQuickPreviewState | null
  setQuickPreview: (next: WorkspaceCanvasQuickPreviewState | null) => void
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  nodeDragSession: WorkspaceCanvasNodeDragSession
  finalizeDraggedNodeDrop: (input: {
    draggedNodeIds: string[]
    draggedNodePositionById: Map<string, { x: number; y: number }>
    dragStartNodePositionById: Map<string, { x: number; y: number }>
    dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
    dragStartSpaceRectById?: Map<string, WorkspaceSpaceRect>
    dropFlowPoint: { x: number; y: number }
    fallbackNodes: Node<TerminalNodeData>[]
    spaceRectOverrideById?: ReadonlyMap<string, WorkspaceSpaceRect> | null
  }) => void
}): {
  previewFileInSpace: (
    spaceId: string,
    uri: string,
    options?: { explorerPlacementPx?: ExplorerPlacementPx },
  ) => void
  openFileInSpace: (
    spaceId: string,
    uri: string,
    options?: { explorerPlacementPx?: ExplorerPlacementPx },
  ) => void
  materializeQuickPreview: () => void
  beginQuickPreviewDrag: (event: React.MouseEvent<HTMLElement>) => void
} {
  const previewFileInSpace = React.useCallback(
    (
      spaceId: string,
      uri: string,
      inputOptions?: {
        explorerPlacementPx?: ExplorerPlacementPx
      },
    ) => {
      const sequence = options.beginTransientRequest()
      void options.resolveQuickPreviewState(spaceId, uri, inputOptions).then(preview => {
        if (!options.isTransientRequestCurrent(sequence)) {
          return
        }

        options.setQuickPreview(preview)
      })
    },
    [options],
  )

  const openFileInSpace = React.useCallback(
    (
      spaceId: string,
      uri: string,
      inputOptions?: {
        explorerPlacementPx?: ExplorerPlacementPx
      },
    ) => {
      const existingPreview =
        options.quickPreview &&
        options.quickPreview.spaceId === spaceId &&
        options.quickPreview.uri === uri.trim()
          ? options.quickPreview
          : null
      const sequence = options.beginTransientRequest()
      options.setQuickPreview(null)

      void (async () => {
        const preview =
          existingPreview ??
          (await options.resolveQuickPreviewState(spaceId, uri, inputOptions)) ??
          null
        if (!preview || !options.isTransientRequestCurrent(sequence)) {
          return
        }

        const created = await options.materializePreviewState(preview, {
          focusViewportOnCreate: false,
          isRequestCurrent: () => options.isTransientRequestCurrent(sequence),
        })
        if (created && options.isTransientRequestCurrent(sequence)) {
          options.setQuickPreview(null)
        }
      })()
    },
    [options],
  )

  const materializeQuickPreview = React.useCallback(() => {
    if (!options.quickPreview) {
      return
    }

    const sequence = options.beginTransientRequest()
    options.setQuickPreview(null)
    void options.materializePreviewState(options.quickPreview, {
      focusViewportOnCreate: false,
      isRequestCurrent: () => options.isTransientRequestCurrent(sequence),
      usePreviewRectAsAnchor: false,
    })
  }, [options])

  const beginQuickPreviewDrag = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const preview = options.quickPreview
      if (!preview) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const startClient = { x: event.clientX, y: event.clientY }
      let latestClient = startClient
      let materializedNodeId: string | null = null
      let didCrossDragThreshold = false
      let released = false
      let cleanedUp = false
      let latestDraggedNodePositionById = new Map<string, { x: number; y: number }>()
      let latestSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null = null
      const sequence = options.beginTransientRequest()

      const clearDragProjection = () => {
        latestSpaceFramePreview = null
        options.nodeDragSession.clearNodeDragProjection()
      }

      const syncNodePosition = () => {
        if (!materializedNodeId) {
          return
        }

        const zoom = options.reactFlow.getZoom() || 1
        const dx = (latestClient.x - startClient.x) / zoom
        const dy = (latestClient.y - startClient.y) / zoom
        const desiredPosition = {
          x: preview.rect.x + dx,
          y: preview.rect.y + dy,
        }
        const dropFlowPoint = options.reactFlow.screenToFlowPosition(latestClient)

        options.setNodes(
          prevNodes => {
            const projected = options.nodeDragSession.projectNodeDrag({
              currentNodes: prevNodes,
              draggedNodeIds: [materializedNodeId!],
              desiredDraggedPositionById: new Map([[materializedNodeId!, desiredPosition]]),
              dropFlowPoint,
            })
            latestSpaceFramePreview = projected.nextSpaceFramePreview
            latestDraggedNodePositionById = projected.nextDraggedNodePositionById
            return projected.nextNodes
          },
          { syncLayout: false },
        )
      }

      const cleanup = () => {
        if (cleanedUp) {
          return
        }

        cleanedUp = true
        window.removeEventListener('mousemove', handleMouseMove, true)
        window.removeEventListener('mouseup', handleMouseUp, true)
      }

      const finalizeMaterializedDrag = () => {
        const dragStartNodePositionById =
          options.nodeDragSession.dragBaselinePositionByIdRef.current
        const dragStartSpaceRectById = options.nodeDragSession.dragBaselineSpaceRectByIdRef.current
        if (!materializedNodeId || !dragStartNodePositionById || !dragStartSpaceRectById) {
          clearDragProjection()
          options.nodeDragSession.endNodeDragSession()
          cleanup()
          return
        }

        const fallbackNode =
          options.nodesRef.current.find(node => node.id === materializedNodeId) ?? null

        options.finalizeDraggedNodeDrop({
          draggedNodeIds: [materializedNodeId],
          draggedNodePositionById: latestDraggedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById: dragStartNodePositionById,
          dragStartSpaceRectById,
          dropFlowPoint: options.reactFlow.screenToFlowPosition(latestClient),
          fallbackNodes: fallbackNode ? [fallbackNode] : [],
          spaceRectOverrideById: latestSpaceFramePreview,
        })
        options.nodeDragSession.endNodeDragSession()
        cleanup()
      }

      const materialize = async () => {
        const created = await options.materializePreviewState(preview, {
          focusViewportOnCreate: false,
          isRequestCurrent: () => options.isTransientRequestCurrent(sequence),
          usePreviewRectAsAnchor: true,
        })
        if (!created) {
          clearDragProjection()
          cleanup()
          return
        }

        materializedNodeId = created.id
        const materializedNode =
          options.nodesRef.current.find(node => node.id === created.id) ?? created
        options.nodeDragSession.beginNodeDragSession(options.nodesRef.current)
        latestDraggedNodePositionById = new Map([
          [
            materializedNode.id,
            {
              x: materializedNode.position.x,
              y: materializedNode.position.y,
            },
          ],
        ])
        if (options.isTransientRequestCurrent(sequence)) {
          options.setQuickPreview(null)
        }
        syncNodePosition()

        if (released) {
          finalizeMaterializedDrag()
        }
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        latestClient = {
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        }

        if (!didCrossDragThreshold) {
          const deltaX = latestClient.x - startClient.x
          const deltaY = latestClient.y - startClient.y
          if (Math.hypot(deltaX, deltaY) < 4) {
            return
          }

          didCrossDragThreshold = true
          void materialize()
          return
        }

        syncNodePosition()
      }

      const handleMouseUp = (upEvent: MouseEvent) => {
        latestClient = {
          x: upEvent.clientX,
          y: upEvent.clientY,
        }
        released = true

        if (!materializedNodeId) {
          cleanup()
          return
        }

        syncNodePosition()
        finalizeMaterializedDrag()
      }

      window.addEventListener('mousemove', handleMouseMove, true)
      window.addEventListener('mouseup', handleMouseUp, true)
    },
    [options],
  )

  return {
    previewFileInSpace,
    openFileInSpace,
    materializeQuickPreview,
    beginQuickPreviewDrag,
  }
}
