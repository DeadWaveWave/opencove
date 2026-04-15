import React from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { findNearestFreePositionOnRight, type Rect } from '../../../utils/collision'
import { resolveImageNodeSizeFromNaturalDimensions } from '../../../utils/workspaceNodeSizing'
import { resolveDefaultDocumentWindowSize, resolveDefaultImageWindowSize } from '../constants'
import type { WorkspaceCanvasQuickPreviewState } from '../types'
import { focusNodeInViewport } from '../helpers'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import {
  findBlockingOpenDocumentForMutation,
  type SpaceExplorerOpenDocumentBlock,
} from './useSpaceExplorer.guards'
// prettier-ignore
import { readImageNaturalDimensions, resolveCanvasImageMimeType, resolveFileNameFromFileUri } from './useSpaceExplorer.helpers'
import type { SpaceExplorerClipboardItem } from '../view/WorkspaceSpaceExplorerOverlay.operations'
import { resolveFlowRectPlacement, type ExplorerPlacementPx } from './useSpaceExplorer.placement'
import type {
  WorkspaceCanvasSpaceExplorerArgs,
  WorkspaceCanvasSpaceExplorerResult,
} from './useSpaceExplorer.types'
import { useWorkspaceCanvasSpaceExplorerQuickPreviewActions } from './useSpaceExplorer.quickPreviewActions'
import { useWorkspaceCanvasSpaceExplorerQuickPreviewDismiss } from './useSpaceExplorer.quickPreviewDismiss'

export function useWorkspaceCanvasSpaceExplorer({
  canvasRef,
  spaces,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  reactFlow,
  nodeDragSession,
  finalizeDraggedNodeDrop,
  createDocumentNode,
  createImageNode,
  standardWindowSizeBucket,
}: WorkspaceCanvasSpaceExplorerArgs): WorkspaceCanvasSpaceExplorerResult {
  const [openExplorerSpaceId, setOpenExplorerSpaceId] = React.useState<string | null>(null)
  // prettier-ignore
  const [explorerClipboard, setExplorerClipboardState] = React.useState<SpaceExplorerClipboardItem | null>(null)
  // prettier-ignore
  const [quickPreview, setQuickPreview] = React.useState<WorkspaceCanvasQuickPreviewState | null>(null)
  const transientRequestSequenceRef = React.useRef(0)
  const beginTransientRequest = React.useCallback(() => {
    const next = transientRequestSequenceRef.current + 1
    transientRequestSequenceRef.current = next
    return next
  }, [])
  const isTransientRequestCurrent = React.useCallback((sequence: number): boolean => {
    return transientRequestSequenceRef.current === sequence
  }, [])

  const dismissQuickPreview = React.useCallback(() => {
    transientRequestSequenceRef.current += 1
    setQuickPreview(null)
  }, [])

  React.useEffect(() => {
    if (!openExplorerSpaceId) {
      dismissQuickPreview()
      return
    }

    if (spaces.some(space => space.id === openExplorerSpaceId)) {
      return
    }

    setOpenExplorerSpaceId(null)
    dismissQuickPreview()
  }, [dismissQuickPreview, openExplorerSpaceId, spaces])

  React.useEffect(() => {
    const preview = quickPreview
    if (!preview) {
      return
    }

    if (openExplorerSpaceId !== preview.spaceId) {
      dismissQuickPreview()
    }
  }, [dismissQuickPreview, openExplorerSpaceId, quickPreview])

  useWorkspaceCanvasSpaceExplorerQuickPreviewDismiss({ quickPreview, dismissQuickPreview })

  const openSpaceExplorer = React.useCallback((spaceId: string) => {
    const normalized = spaceId.trim()
    if (normalized.length === 0) {
      return
    }

    setOpenExplorerSpaceId(normalized)
  }, [])

  const closeSpaceExplorer = React.useCallback(() => {
    setOpenExplorerSpaceId(null)
    dismissQuickPreview()
  }, [dismissQuickPreview])

  const toggleSpaceExplorer = React.useCallback(
    (spaceId: string) => {
      const normalized = spaceId.trim()
      if (normalized.length === 0) {
        return
      }

      setOpenExplorerSpaceId(previous => {
        const next = previous === normalized ? null : normalized
        if (next !== normalized) {
          dismissQuickPreview()
        }
        return next
      })
    },
    [dismissQuickPreview],
  )

  const setExplorerClipboard = React.useCallback((next: SpaceExplorerClipboardItem | null) => {
    setExplorerClipboardState(next)
  }, [])

  const findBlockingOpenDocument = React.useCallback(
    (uri: string): SpaceExplorerOpenDocumentBlock | null =>
      findBlockingOpenDocumentForMutation(nodesRef.current, uri),
    [nodesRef],
  )

  const resolveQuickPreviewState = React.useCallback(
    async (
      spaceId: string,
      uri: string,
      options?: { explorerPlacementPx?: ExplorerPlacementPx },
    ): Promise<WorkspaceCanvasQuickPreviewState | null> => {
      const normalizedUri = uri.trim()
      if (normalizedUri.length === 0) {
        return null
      }

      let parsed: URL | null = null
      try {
        parsed = new URL(normalizedUri)
      } catch {
        parsed = null
      }

      if (!parsed || parsed.protocol !== 'file:') {
        return null
      }

      const space = spacesRef.current.find(candidate => candidate.id === spaceId) ?? null
      const spaceRect = space?.rect ?? null
      if (!space || !spaceRect) {
        return null
      }

      const mimeType = resolveCanvasImageMimeType(normalizedUri)
      let kind: WorkspaceCanvasQuickPreviewState['kind'] = 'document'
      let naturalWidth: number | null | undefined
      let naturalHeight: number | null | undefined
      let size = resolveDefaultDocumentWindowSize(standardWindowSizeBucket)

      if (mimeType) {
        kind = 'image'
        const filesystem = window.opencoveApi?.filesystem
        if (filesystem?.readFileBytes) {
          try {
            const { bytes } = await filesystem.readFileBytes({ uri: normalizedUri })
            const dimensions = await readImageNaturalDimensions(bytes, mimeType)
            naturalWidth = dimensions.naturalWidth
            naturalHeight = dimensions.naturalHeight
            size = resolveImageNodeSizeFromNaturalDimensions({
              naturalWidth,
              naturalHeight,
              preferred: resolveDefaultImageWindowSize(),
            })
          } catch {
            size = resolveDefaultImageWindowSize()
          }
        } else {
          size = resolveDefaultImageWindowSize()
        }
      }

      const placement = resolveFlowRectPlacement({
        canvasRef,
        reactFlow,
        placementPx: options?.explorerPlacementPx,
        spaceRect,
        size,
        nodesRef,
        spacesRef,
      })

      return {
        spaceId,
        mountId: space.targetMountId ?? null,
        uri: normalizedUri,
        title: resolveFileNameFromFileUri(normalizedUri) ?? normalizedUri,
        kind,
        rect: placement.rect,
        createAnchor: placement.anchor,
        createPlacement: {
          targetSpaceRect: spaceRect,
          preferredDirection: placement.preferredDirection,
          avoidRects: placement.avoidRects,
        },
        naturalWidth,
        naturalHeight,
      }
    },
    [canvasRef, nodesRef, reactFlow, spacesRef, standardWindowSizeBucket],
  )

  const materializePreviewState = React.useCallback(
    async (
      preview: WorkspaceCanvasQuickPreviewState,
      options?: {
        focusViewportOnCreate?: boolean
        isRequestCurrent?: () => boolean
        usePreviewRectAsAnchor?: boolean
      },
    ): Promise<Node<TerminalNodeData> | null> => {
      if (options?.isRequestCurrent && !options.isRequestCurrent()) {
        return null
      }

      const space = spacesRef.current.find(candidate => candidate.id === preview.spaceId) ?? null
      const rect = space?.rect ?? null
      if (!space || !rect) {
        return null
      }

      if (preview.kind === 'document') {
        const existingNode =
          nodesRef.current.find(node => {
            if (node.data.kind !== 'document' || !node.data.document) {
              return false
            }

            return node.data.document.uri === preview.uri && space.nodeIds.includes(node.id)
          }) ?? null

        if (existingNode) {
          if (options?.isRequestCurrent && !options.isRequestCurrent()) {
            return null
          }

          focusNodeInViewport(reactFlow, existingNode, { duration: 120, zoom: reactFlow.getZoom() })
          return existingNode
        }

        if (options?.isRequestCurrent && !options.isRequestCurrent()) {
          return null
        }

        const creationAnchor = options?.usePreviewRectAsAnchor
          ? {
              x: preview.rect.x,
              y: preview.rect.y,
            }
          : preview.createAnchor

        const creationPlacement = {
          ...(preview.createPlacement ?? {}),
          targetSpaceRect: rect,
          focusViewportOnCreate: options?.focusViewportOnCreate,
        }

        const created = createDocumentNode(creationAnchor, { uri: preview.uri }, creationPlacement)

        if (!created) {
          return null
        }

        const preferRightPlacement = creationPlacement.preferredDirection === 'right'
        if (preferRightPlacement && preview.createPlacement?.avoidRects?.length) {
          const avoidObstacles: Rect[] = preview.createPlacement.avoidRects.map(avoidRect => ({
            left: avoidRect.x,
            top: avoidRect.y,
            right: avoidRect.x + avoidRect.width,
            bottom: avoidRect.y + avoidRect.height,
          }))
          const desired = creationAnchor
          const size = { width: created.data.width, height: created.data.height }
          const nextPlacement = findNearestFreePositionOnRight(
            desired,
            size,
            nodesRef.current,
            created.id,
            avoidObstacles,
          )

          if (
            nextPlacement &&
            (nextPlacement.x !== created.position.x || nextPlacement.y !== created.position.y)
          ) {
            setNodes(
              prevNodes =>
                prevNodes.map(node =>
                  node.id === created.id ? { ...node, position: nextPlacement } : node,
                ),
              { syncLayout: false },
            )
          }
        }

        assignNodeToSpaceAndExpand({
          createdNodeId: created.id,
          targetSpaceId: space.id,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })

        onRequestPersistFlush?.()
        return created
      }

      const filesystem = window.opencoveApi?.filesystem
      const workspace = window.opencoveApi?.workspace
      const mimeType = resolveCanvasImageMimeType(preview.uri)
      if (!filesystem?.readFileBytes || !workspace?.writeCanvasImage || !mimeType) {
        return null
      }

      try {
        const { bytes } = await filesystem.readFileBytes({ uri: preview.uri })
        if (options?.isRequestCurrent && !options.isRequestCurrent()) {
          return null
        }

        const assetId = crypto.randomUUID()
        const fileName = resolveFileNameFromFileUri(preview.uri)
        await workspace.writeCanvasImage({ assetId, bytes, mimeType, fileName })
        if (options?.isRequestCurrent && !options.isRequestCurrent()) {
          return null
        }

        const resolvedDimensions =
          typeof preview.naturalWidth === 'number' && typeof preview.naturalHeight === 'number'
            ? {
                naturalWidth: preview.naturalWidth,
                naturalHeight: preview.naturalHeight,
              }
            : await readImageNaturalDimensions(bytes, mimeType)
        if (options?.isRequestCurrent && !options.isRequestCurrent()) {
          return null
        }

        const creationAnchor = options?.usePreviewRectAsAnchor
          ? {
              x: preview.rect.x,
              y: preview.rect.y,
            }
          : preview.createAnchor

        const creationPlacement = {
          ...(preview.createPlacement ?? {}),
          targetSpaceRect: rect,
          focusViewportOnCreate: options?.focusViewportOnCreate,
        }

        const created = createImageNode(
          creationAnchor,
          {
            assetId,
            mimeType,
            fileName,
            naturalWidth: resolvedDimensions.naturalWidth,
            naturalHeight: resolvedDimensions.naturalHeight,
          },
          creationPlacement,
        )

        if (!created) {
          return null
        }

        const preferRightPlacement = creationPlacement.preferredDirection === 'right'
        if (preferRightPlacement && preview.createPlacement?.avoidRects?.length) {
          const avoidObstacles: Rect[] = preview.createPlacement.avoidRects.map(avoidRect => ({
            left: avoidRect.x,
            top: avoidRect.y,
            right: avoidRect.x + avoidRect.width,
            bottom: avoidRect.y + avoidRect.height,
          }))
          const desired = creationAnchor
          const size = { width: created.data.width, height: created.data.height }
          const nextPlacement = findNearestFreePositionOnRight(
            desired,
            size,
            nodesRef.current,
            created.id,
            avoidObstacles,
          )

          if (
            nextPlacement &&
            (nextPlacement.x !== created.position.x || nextPlacement.y !== created.position.y)
          ) {
            setNodes(
              prevNodes =>
                prevNodes.map(node =>
                  node.id === created.id ? { ...node, position: nextPlacement } : node,
                ),
              { syncLayout: false },
            )
          }
        }

        assignNodeToSpaceAndExpand({
          createdNodeId: created.id,
          targetSpaceId: space.id,
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
        })

        onRequestPersistFlush?.()
        return created
      } catch {
        return null
      }
    },
    [
      createDocumentNode,
      createImageNode,
      nodesRef,
      onRequestPersistFlush,
      onSpacesChange,
      reactFlow,
      setNodes,
      spacesRef,
    ],
  )

  const { previewFileInSpace, openFileInSpace, materializeQuickPreview, beginQuickPreviewDrag } =
    useWorkspaceCanvasSpaceExplorerQuickPreviewActions({
      beginTransientRequest,
      isTransientRequestCurrent,
      resolveQuickPreviewState,
      materializePreviewState,
      quickPreview,
      setQuickPreview,
      nodesRef,
      setNodes,
      reactFlow,
      nodeDragSession,
      finalizeDraggedNodeDrop,
    })

  return {
    openExplorerSpaceId,
    explorerClipboard,
    quickPreview,
    openSpaceExplorer,
    closeSpaceExplorer,
    toggleSpaceExplorer,
    setExplorerClipboard,
    findBlockingOpenDocument,
    previewFileInSpace,
    openFileInSpace,
    dismissQuickPreview,
    materializeQuickPreview,
    beginQuickPreviewDrag,
  }
}
