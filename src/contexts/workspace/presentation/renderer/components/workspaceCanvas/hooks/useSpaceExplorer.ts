import React from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type {
  DocumentNodeData,
  ImageNodeData,
  Point,
  TerminalNodeData,
  WorkspaceSpaceRect,
  WorkspaceSpaceState,
} from '../../../types'
import { resolveImageNodeSizeFromNaturalDimensions } from '../../../utils/workspaceNodeSizing'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import { resolveWorkspaceSnap, type WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import {
  resolveDefaultDocumentWindowSize,
  resolveDefaultImageWindowSize,
} from '../constants'
import type {
  NodeCreationPlacementOptions,
  NodePlacementOptions,
  WorkspaceCanvasQuickPreviewState,
} from '../types'
import { focusNodeInViewport } from '../helpers'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import {
  areSpaceRectsEqual,
  buildDragBaselineNodes,
  setResolvedSnapGuides,
  setResolvedSpaceFramePreview,
} from './useApplyNodeChanges.helpers'
import {
  findBlockingOpenDocumentForMutation,
  type SpaceExplorerOpenDocumentBlock,
} from './useSpaceExplorer.guards'
import {
  readImageNaturalDimensions,
  resolveCanvasImageMimeType,
  resolveFileNameFromFileUri,
} from './useSpaceExplorer.helpers'
import { resolveNodesPlacement } from './useNodesStore.resolvePlacement'
import { projectWorkspaceNodeDropLayout } from './useSpaceOwnership.projectDropLayout'
import type { SpaceExplorerClipboardItem } from '../view/WorkspaceSpaceExplorerOverlay.operations'

interface ExplorerPlacementPx {
  left: number
  top: number
  width: number
  height: number
}

interface ResolvedExplorerPlacement {
  anchor: Point
  avoidRects?: Array<{ x: number; y: number; width: number; height: number }>
  preferredDirection?: NodePlacementOptions['preferredDirection']
}

function clampQuickPreviewRectToSpace(options: {
  position: Point
  size: { width: number; height: number }
  spaceRect: NonNullable<WorkspaceSpaceState['rect']>
}): WorkspaceCanvasQuickPreviewState['rect'] {
  const { position, size, spaceRect } = options
  const paddingX = 18
  const paddingY = 16
  const minX = spaceRect.x + paddingX
  const maxX = Math.max(minX, spaceRect.x + spaceRect.width - size.width - paddingX)
  const minY = spaceRect.y + paddingY
  const maxY = Math.max(minY, spaceRect.y + spaceRect.height - size.height - paddingY)

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
    width: size.width,
    height: size.height,
  }
}

function resolveFlowRectPlacement(options: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  placementPx?: ExplorerPlacementPx
  spaceRect: WorkspaceSpaceState['rect']
  size: { width: number; height: number }
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
}): ResolvedExplorerPlacement & { rect: WorkspaceCanvasQuickPreviewState['rect'] } {
  const { canvasRef, reactFlow, placementPx, spaceRect, size, nodesRef, spacesRef } = options

  const baseAnchor = {
    x: spaceRect!.x + 24,
    y: spaceRect!.y + 46,
  }
  const resolveAnchoredRect = (clientPoint: { x: number; y: number } | null) => {
    if (!clientPoint) {
      return null
    }

    const topLeft = reactFlow.screenToFlowPosition(clientPoint)
    if (!Number.isFinite(topLeft.x) || !Number.isFinite(topLeft.y)) {
      return null
    }

    return clampQuickPreviewRectToSpace({
      position: topLeft,
      size,
      spaceRect: spaceRect!,
    })
  }

  const resolvedPlacement = (() => {
    const gapPx = 20
    const canvas = canvasRef.current

    if (placementPx && canvas) {
      const bounds = canvas.getBoundingClientRect()
      if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top)) {
        const anchoredRect = resolveAnchoredRect({
          x: bounds.left + placementPx.left + placementPx.width + gapPx,
          y: bounds.top + placementPx.top,
        })
        if (anchoredRect) {
          return {
            anchor: {
              x: anchoredRect.x,
              y: anchoredRect.y,
            },
            rect: anchoredRect,
            avoidRects: undefined,
            preferredDirection: 'right' as const,
          }
        }
      }
    }

    const explorerElement = document.querySelector(
      '[data-testid="workspace-space-explorer"]',
    ) as HTMLElement | null
    if (explorerElement) {
      const bounds = explorerElement.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        const anchoredRect = resolveAnchoredRect({
          x: bounds.right + gapPx,
          y: bounds.top,
        })
        if (anchoredRect) {
          return {
            anchor: {
              x: anchoredRect.x,
              y: anchoredRect.y,
            },
            rect: anchoredRect,
            avoidRects: undefined,
            preferredDirection: 'right' as const,
          }
        }
      }
    }

    const fallbackPlacement = resolveNodesPlacement({
      anchor: baseAnchor,
      size,
      getNodes: () => nodesRef.current,
      getSpaceRects: () =>
        spacesRef.current
          .map(space => space.rect)
          .filter(
            (rect): rect is { x: number; y: number; width: number; height: number } =>
              rect !== null,
          ),
      targetSpaceRect: spaceRect,
      preferredDirection: undefined,
      avoidRects: undefined,
    })

    return {
      anchor: baseAnchor,
      rect: {
        x: fallbackPlacement.placement.x,
        y: fallbackPlacement.placement.y,
        width: size.width,
        height: size.height,
      },
      avoidRects: undefined,
      preferredDirection: undefined,
    }
  })()

  return {
    anchor: resolvedPlacement.anchor,
    avoidRects: resolvedPlacement.avoidRects,
    preferredDirection: resolvedPlacement.preferredDirection,
    rect: resolvedPlacement.rect,
  }
}

export function useWorkspaceCanvasSpaceExplorer({
  canvasRef,
  spaces,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  reactFlow,
  magneticSnappingEnabledRef,
  setSnapGuides,
  setSpaceFramePreview,
  finalizeDraggedNodeDrop,
  createDocumentNode,
  createImageNode,
  standardWindowSizeBucket,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  spaces: WorkspaceSpaceState[]
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: React.MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ) => void
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  magneticSnappingEnabledRef: React.MutableRefObject<boolean>
  setSnapGuides: React.Dispatch<React.SetStateAction<WorkspaceSnapGuide[] | null>>
  setSpaceFramePreview: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  >
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
  createDocumentNode: (
    anchor: Point,
    document: DocumentNodeData,
    placement?: NodeCreationPlacementOptions,
  ) => Node<TerminalNodeData> | null
  createImageNode: (
    anchor: Point,
    image: ImageNodeData,
    placement?: NodeCreationPlacementOptions,
  ) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: 'compact' | 'regular' | 'large'
}): {
  openExplorerSpaceId: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  quickPreview: WorkspaceCanvasQuickPreviewState | null
  openSpaceExplorer: (spaceId: string) => void
  closeSpaceExplorer: () => void
  toggleSpaceExplorer: (spaceId: string) => void
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
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
  dismissQuickPreview: () => void
  materializeQuickPreview: () => void
  beginQuickPreviewDrag: (event: React.MouseEvent<HTMLElement>) => void
} {
  const [openExplorerSpaceId, setOpenExplorerSpaceId] = React.useState<string | null>(null)
  const [explorerClipboard, setExplorerClipboardState] =
    React.useState<SpaceExplorerClipboardItem | null>(null)
  const [quickPreview, setQuickPreview] = React.useState<WorkspaceCanvasQuickPreviewState | null>(
    null,
  )
  const previewSequenceRef = React.useRef(0)

  const dismissQuickPreview = React.useCallback(() => {
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

  React.useEffect(() => {
    if (!quickPreview) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        dismissQuickPreview()
        return
      }

      if (event.target.closest('.workspace-space-quick-preview')) {
        return
      }

      if (event.target.closest('.workspace-space-explorer__entry')) {
        return
      }

      dismissQuickPreview()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      dismissQuickPreview()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [dismissQuickPreview, quickPreview])

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
        uri: normalizedUri,
        title: resolveFileNameFromFileUri(normalizedUri) ?? normalizedUri,
        kind,
        rect: placement.rect,
        naturalWidth,
        naturalHeight,
      }
    },
    [canvasRef, nodesRef, reactFlow, spacesRef, standardWindowSizeBucket],
  )

  const materializePreviewState = React.useCallback(
    async (
      preview: WorkspaceCanvasQuickPreviewState,
      options?: { focusViewportOnCreate?: boolean },
    ): Promise<Node<TerminalNodeData> | null> => {
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
          focusNodeInViewport(reactFlow, existingNode, { duration: 120, zoom: reactFlow.getZoom() })
          return existingNode
        }

        const created = createDocumentNode(
          {
            x: preview.rect.x,
            y: preview.rect.y,
          },
          { uri: preview.uri },
          {
            targetSpaceRect: rect,
            focusViewportOnCreate: options?.focusViewportOnCreate,
          },
        )

        if (!created) {
          return null
        }

        setNodes(
          prevNodes => {
            let didUpdateCreatedNode = false
            const nextNodes = prevNodes.map(node => {
              if (node.id !== created.id) {
                return node
              }

              didUpdateCreatedNode = true
              return {
                ...node,
                position: {
                  x: preview.rect.x,
                  y: preview.rect.y,
                },
              }
            })

            if (didUpdateCreatedNode) {
              return nextNodes
            }

            return [
              ...prevNodes,
              {
                ...created,
                position: {
                  x: preview.rect.x,
                  y: preview.rect.y,
                },
              },
            ]
          },
          { syncLayout: false },
        )

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
        const assetId = crypto.randomUUID()
        const fileName = resolveFileNameFromFileUri(preview.uri)
        await workspace.writeCanvasImage({ assetId, bytes, mimeType, fileName })

        const resolvedDimensions =
          typeof preview.naturalWidth === 'number' && typeof preview.naturalHeight === 'number'
            ? {
                naturalWidth: preview.naturalWidth,
                naturalHeight: preview.naturalHeight,
              }
            : await readImageNaturalDimensions(bytes, mimeType)

        const created = createImageNode(
          {
            x: preview.rect.x,
            y: preview.rect.y,
          },
          {
            assetId,
            mimeType,
            fileName,
            naturalWidth: resolvedDimensions.naturalWidth,
            naturalHeight: resolvedDimensions.naturalHeight,
          },
          {
            targetSpaceRect: rect,
            focusViewportOnCreate: options?.focusViewportOnCreate,
          },
        )

        if (!created) {
          return null
        }

        setNodes(
          prevNodes => {
            let didUpdateCreatedNode = false
            const nextNodes = prevNodes.map(node => {
              if (node.id !== created.id) {
                return node
              }

              didUpdateCreatedNode = true
              return {
                ...node,
                position: {
                  x: preview.rect.x,
                  y: preview.rect.y,
                },
              }
            })

            if (didUpdateCreatedNode) {
              return nextNodes
            }

            return [
              ...prevNodes,
              {
                ...created,
                position: {
                  x: preview.rect.x,
                  y: preview.rect.y,
                },
              },
            ]
          },
          { syncLayout: false },
        )

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

  const previewFileInSpace = React.useCallback(
    (
      spaceId: string,
      uri: string,
      options?: {
        explorerPlacementPx?: ExplorerPlacementPx
      },
    ) => {
      const sequence = (previewSequenceRef.current += 1)
      void resolveQuickPreviewState(spaceId, uri, options).then(preview => {
        if (previewSequenceRef.current !== sequence) {
          return
        }

        setQuickPreview(preview)
      })
    },
    [resolveQuickPreviewState],
  )

  const openFileInSpace = React.useCallback(
    (
      spaceId: string,
      uri: string,
      options?: {
        explorerPlacementPx?: ExplorerPlacementPx
      },
    ) => {
      const existingPreview =
        quickPreview && quickPreview.spaceId === spaceId && quickPreview.uri === uri.trim()
          ? quickPreview
          : null

      void (async () => {
        const preview =
          existingPreview ?? (await resolveQuickPreviewState(spaceId, uri, options)) ?? null
        if (!preview) {
          return
        }

        const created = await materializePreviewState(preview, {
          focusViewportOnCreate: false,
        })
        if (created) {
          dismissQuickPreview()
        }
      })()
    },
    [dismissQuickPreview, materializePreviewState, quickPreview, resolveQuickPreviewState],
  )

  const materializeQuickPreview = React.useCallback(() => {
    if (!quickPreview) {
      return
    }

    void materializePreviewState(quickPreview, { focusViewportOnCreate: false }).then(created => {
      if (created) {
        dismissQuickPreview()
      }
    })
  }, [dismissQuickPreview, materializePreviewState, quickPreview])

  const beginQuickPreviewDrag = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const preview = quickPreview
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
      let dragStartNodePositionById: Map<string, { x: number; y: number }> | null = null
      let dragStartAllNodePositionById: Map<string, { x: number; y: number }> | null = null
      let dragStartSpaceRectById: Map<string, WorkspaceSpaceRect> | null = null
      let latestDraggedNodePositionById = new Map<string, { x: number; y: number }>()
      let latestSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null = null

      const clearDragProjection = () => {
        latestSpaceFramePreview = null
        setResolvedSnapGuides(setSnapGuides, null)
        setResolvedSpaceFramePreview(setSpaceFramePreview, null)
      }

      const syncNodePosition = () => {
        if (
          !materializedNodeId ||
          !dragStartNodePositionById ||
          !dragStartAllNodePositionById ||
          !dragStartSpaceRectById
        ) {
          return
        }

        const zoom = reactFlow.getZoom() || 1
        const dx = (latestClient.x - startClient.x) / zoom
        const dy = (latestClient.y - startClient.y) / zoom
        const desiredPosition = {
          x: preview.rect.x + dx,
          y: preview.rect.y + dy,
        }
        const dragStartPosition =
          dragStartNodePositionById.get(materializedNodeId) ?? desiredPosition
        const dropFlowPoint = reactFlow.screenToFlowPosition(latestClient)

        setNodes(prevNodes => {
          const baselineNodes = buildDragBaselineNodes({
            nodes: prevNodes,
            baselinePositionById: dragStartAllNodePositionById,
            shiftNodeIds: null,
          })
          let draggedNodePositionById = new Map([[materializedNodeId!, desiredPosition]])

          if (magneticSnappingEnabledRef.current) {
            const snapNodes = baselineNodes.map(node =>
              node.id === materializedNodeId
                ? {
                    ...node,
                    position: desiredPosition,
                  }
                : node,
            )
            const movingNodes = snapNodes.filter(node => node.id === materializedNodeId)
            const movingRect = unionWorkspaceNodeRects(movingNodes)

            if (movingRect) {
              const snapped = resolveWorkspaceSnap({
                movingRect,
                candidateRects: resolveWorkspaceNodeSnapCandidateRects({
                  movingNodeIds: new Set([materializedNodeId!]),
                  nodes: snapNodes,
                  spaces: spacesRef.current,
                }),
                grid: WORKSPACE_ARRANGE_GRID_PX,
                threshold: 8,
                enableGrid: true,
                enableObject: true,
              })

              setResolvedSnapGuides(
                setSnapGuides,
                snapped.guides.length > 0 ? snapped.guides : null,
              )

              if (snapped.dx !== 0 || snapped.dy !== 0) {
                draggedNodePositionById = new Map([
                  [
                    materializedNodeId!,
                    {
                      x: desiredPosition.x + snapped.dx,
                      y: desiredPosition.y + snapped.dy,
                    },
                  ],
                ])
              }
            } else {
              setResolvedSnapGuides(setSnapGuides, null)
            }
          } else {
            setResolvedSnapGuides(setSnapGuides, null)
          }

          const snappedPosition =
            draggedNodePositionById.get(materializedNodeId!) ?? desiredPosition
          const projected = projectWorkspaceNodeDropLayout({
            nodes: baselineNodes,
            spaces: spacesRef.current,
            draggedNodeIds: [materializedNodeId!],
            draggedNodePositionById,
            dragDx: snappedPosition.x - dragStartPosition.x,
            dragDy: snappedPosition.y - dragStartPosition.y,
            dropFlowPoint,
          })

          const currentRectsById = new Map(
            spacesRef.current
              .filter(space => Boolean(space.rect))
              .map(space => [space.id, space.rect!] as const),
          )
          let hasSpacePreviewChange = false
          for (const space of projected.nextSpaces) {
            if (!space.rect) {
              continue
            }

            if (!areSpaceRectsEqual(space.rect, currentRectsById.get(space.id) ?? null)) {
              hasSpacePreviewChange = true
              break
            }
          }

          latestSpaceFramePreview = hasSpacePreviewChange
            ? new Map(
                projected.nextSpaces
                  .filter(space => Boolean(space.rect))
                  .map(space => [space.id, space.rect!] as const),
              )
            : null
          setResolvedSpaceFramePreview(setSpaceFramePreview, latestSpaceFramePreview)

          latestDraggedNodePositionById = new Map([
            [
              materializedNodeId!,
              projected.nextNodePositionById.get(materializedNodeId!) ?? snappedPosition,
            ],
          ])

          return prevNodes.map(node => {
            const nextPosition = projected.nextNodePositionById.get(node.id)
            if (!nextPosition) {
              return node
            }

            if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
              return node
            }

            return {
              ...node,
              position: nextPosition,
            }
          })
        }, { syncLayout: false })
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
        if (
          !materializedNodeId ||
          !dragStartNodePositionById ||
          !dragStartAllNodePositionById ||
          !dragStartSpaceRectById
        ) {
          clearDragProjection()
          cleanup()
          return
        }

        const fallbackNode =
          nodesRef.current.find(node => node.id === materializedNodeId) ?? null

        finalizeDraggedNodeDrop({
          draggedNodeIds: [materializedNodeId],
          draggedNodePositionById: latestDraggedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById,
          dragStartSpaceRectById,
          dropFlowPoint: reactFlow.screenToFlowPosition(latestClient),
          fallbackNodes: fallbackNode ? [fallbackNode] : [],
          spaceRectOverrideById: latestSpaceFramePreview,
        })
        clearDragProjection()
        cleanup()
      }

      const materialize = async () => {
        const created = await materializePreviewState(preview, {
          focusViewportOnCreate: false,
        })
        if (!created) {
          clearDragProjection()
          cleanup()
          return
        }

        materializedNodeId = created.id
        const materializedNode =
          nodesRef.current.find(node => node.id === created.id) ?? created
        dragStartNodePositionById = new Map([
          [
            materializedNode.id,
            {
              x: materializedNode.position.x,
              y: materializedNode.position.y,
            },
          ],
        ])
        dragStartAllNodePositionById = new Map(
          nodesRef.current.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
        )
        dragStartSpaceRectById = new Map(
          spacesRef.current
            .filter(space => Boolean(space.rect))
            .map(space => [space.id, { ...space.rect! }] as const),
        )
        latestDraggedNodePositionById = new Map([
          [
            materializedNode.id,
            {
              x: materializedNode.position.x,
              y: materializedNode.position.y,
            },
          ],
        ])
        dismissQuickPreview()
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
    [
      dismissQuickPreview,
      finalizeDraggedNodeDrop,
      magneticSnappingEnabledRef,
      materializePreviewState,
      nodesRef,
      quickPreview,
      reactFlow,
      setNodes,
      setSnapGuides,
      setSpaceFramePreview,
      spacesRef,
    ],
  )

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
