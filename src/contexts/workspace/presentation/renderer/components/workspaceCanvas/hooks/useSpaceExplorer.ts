import React from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type {
  DocumentNodeData,
  ImageNodeData,
  Point,
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../types'
import { findNearestFreePositionOnRight, type Rect } from '../../../utils/collision'
import { focusNodeInViewport } from '../helpers'
import { assignNodeToSpaceAndExpand } from './useInteractions.spaceAssignment'
import type { NodePlacementOptions } from '../types'
import {
  findBlockingOpenDocumentForMutation,
  type SpaceExplorerOpenDocumentBlock,
} from './useSpaceExplorer.guards'
import {
  readImageNaturalDimensions,
  resolveCanvasImageMimeType,
  resolveFileNameFromFileUri,
} from './useSpaceExplorer.helpers'
import type { SpaceExplorerClipboardItem } from '../view/WorkspaceSpaceExplorerOverlay.operations'

export function useWorkspaceCanvasSpaceExplorer({
  canvasRef,
  spaces,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  reactFlow,
  createDocumentNode,
  createImageNode,
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
  createDocumentNode: (
    anchor: Point,
    document: DocumentNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
  createImageNode: (
    anchor: Point,
    image: ImageNodeData,
    placement?: NodePlacementOptions,
  ) => Node<TerminalNodeData> | null
}): {
  openExplorerSpaceId: string | null
  explorerClipboard: SpaceExplorerClipboardItem | null
  openSpaceExplorer: (spaceId: string) => void
  closeSpaceExplorer: () => void
  toggleSpaceExplorer: (spaceId: string) => void
  setExplorerClipboard: (next: SpaceExplorerClipboardItem | null) => void
  findBlockingOpenDocument: (uri: string) => SpaceExplorerOpenDocumentBlock | null
  openFileInSpace: (
    spaceId: string,
    uri: string,
    options?: {
      explorerPlacementPx?: { left: number; top: number; width: number; height: number }
    },
  ) => void
} {
  const [openExplorerSpaceId, setOpenExplorerSpaceId] = React.useState<string | null>(null)
  const [explorerClipboard, setExplorerClipboardState] =
    React.useState<SpaceExplorerClipboardItem | null>(null)

  React.useEffect(() => {
    if (!openExplorerSpaceId) {
      return
    }

    if (spaces.some(space => space.id === openExplorerSpaceId)) {
      return
    }

    setOpenExplorerSpaceId(null)
  }, [openExplorerSpaceId, spaces])

  const openSpaceExplorer = React.useCallback((spaceId: string) => {
    const normalized = spaceId.trim()
    if (normalized.length === 0) {
      return
    }

    setOpenExplorerSpaceId(normalized)
  }, [])

  const closeSpaceExplorer = React.useCallback(() => {
    setOpenExplorerSpaceId(null)
  }, [])

  const toggleSpaceExplorer = React.useCallback((spaceId: string) => {
    const normalized = spaceId.trim()
    if (normalized.length === 0) {
      return
    }

    setOpenExplorerSpaceId(previous => (previous === normalized ? null : normalized))
  }, [])

  const setExplorerClipboard = React.useCallback((next: SpaceExplorerClipboardItem | null) => {
    setExplorerClipboardState(next)
  }, [])

  const findBlockingOpenDocument = React.useCallback(
    (uri: string): SpaceExplorerOpenDocumentBlock | null =>
      findBlockingOpenDocumentForMutation(nodesRef.current, uri),
    [nodesRef],
  )

  const openFileInSpace = React.useCallback(
    (
      spaceId: string,
      uri: string,
      options?: {
        explorerPlacementPx?: { left: number; top: number; width: number; height: number }
      },
    ) => {
      const normalizedUri = uri.trim()
      if (normalizedUri.length === 0) {
        return
      }

      let parsed: URL | null = null
      try {
        parsed = new URL(normalizedUri)
      } catch {
        parsed = null
      }

      if (!parsed || parsed.protocol !== 'file:') {
        return
      }

      const mimeType = resolveCanvasImageMimeType(normalizedUri)
      const space = spacesRef.current.find(candidate => candidate.id === spaceId) ?? null
      const rect = space?.rect ?? null

      if (!space || !rect) {
        return
      }

      const baseAnchor = {
        x: rect.x + 24,
        y: rect.y + 46,
      }

      const placement = (() => {
        const gapPx = 44
        const paddingPx = 8

        const placementPx = options?.explorerPlacementPx ?? null
        const canvas = canvasRef.current

        // Prefer the measured placement coming from the Explorer overlay, because its pixel frame
        // matches the layout engine (and avoids transient animation transforms).
        if (placementPx && canvas) {
          if (
            typeof placementPx.left === 'number' &&
            Number.isFinite(placementPx.left) &&
            typeof placementPx.top === 'number' &&
            Number.isFinite(placementPx.top) &&
            typeof placementPx.width === 'number' &&
            Number.isFinite(placementPx.width) &&
            placementPx.width > 0 &&
            typeof placementPx.height === 'number' &&
            Number.isFinite(placementPx.height) &&
            placementPx.height > 0
          ) {
            const bounds = canvas.getBoundingClientRect()
            if (Number.isFinite(bounds.left) && Number.isFinite(bounds.top)) {
              const anchorClient = {
                x: bounds.left + placementPx.left + placementPx.width + gapPx,
                y: bounds.top + placementPx.top + 46,
              }
              const anchor = reactFlow.screenToFlowPosition(anchorClient)
              if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
                const avoidStart = reactFlow.screenToFlowPosition({
                  x: bounds.left + placementPx.left - paddingPx,
                  y: bounds.top + placementPx.top - paddingPx,
                })
                const avoidEnd = reactFlow.screenToFlowPosition({
                  x: bounds.left + placementPx.left + placementPx.width + paddingPx,
                  y: bounds.top + placementPx.top + placementPx.height + paddingPx,
                })

                const avoidWidth = avoidEnd.x - avoidStart.x
                const avoidHeight = avoidEnd.y - avoidStart.y

                if (
                  Number.isFinite(avoidStart.x) &&
                  Number.isFinite(avoidStart.y) &&
                  Number.isFinite(avoidWidth) &&
                  Number.isFinite(avoidHeight) &&
                  avoidWidth > 0 &&
                  avoidHeight > 0
                ) {
                  return {
                    anchor,
                    avoidRects: [
                      {
                        x: avoidStart.x,
                        y: avoidStart.y,
                        width: avoidWidth,
                        height: avoidHeight,
                      },
                    ],
                  }
                }

                return { anchor, avoidRects: undefined }
              }
            }
          }
        }

        // Fallback: anchor placement to the rendered rect if the caller does not provide one.
        const explorerElement = document.querySelector(
          '[data-testid="workspace-space-explorer"]',
        ) as HTMLElement | null
        if (explorerElement) {
          const bounds = explorerElement.getBoundingClientRect()
          if (bounds.width > 0 && bounds.height > 0) {
            const anchorClient = {
              x: bounds.right + gapPx,
              y: bounds.top + 46,
            }
            const anchor = reactFlow.screenToFlowPosition(anchorClient)
            if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
              const avoidStart = reactFlow.screenToFlowPosition({
                x: bounds.left - paddingPx,
                y: bounds.top - paddingPx,
              })
              const avoidEnd = reactFlow.screenToFlowPosition({
                x: bounds.right + paddingPx,
                y: bounds.bottom + paddingPx,
              })

              const avoidWidth = avoidEnd.x - avoidStart.x
              const avoidHeight = avoidEnd.y - avoidStart.y

              if (
                Number.isFinite(avoidStart.x) &&
                Number.isFinite(avoidStart.y) &&
                Number.isFinite(avoidWidth) &&
                Number.isFinite(avoidHeight) &&
                avoidWidth > 0 &&
                avoidHeight > 0
              ) {
                return {
                  anchor,
                  avoidRects: [
                    {
                      x: avoidStart.x,
                      y: avoidStart.y,
                      width: avoidWidth,
                      height: avoidHeight,
                    },
                  ],
                }
              }

              return { anchor, avoidRects: undefined }
            }
          }
        }

        return { anchor: baseAnchor, avoidRects: undefined }
      })()
      const preferRightPlacement = Boolean(options?.explorerPlacementPx)

      const avoidObstacles: Rect[] | undefined = placement.avoidRects
        ? placement.avoidRects.map(avoidRect => ({
            left: avoidRect.x,
            top: avoidRect.y,
            right: avoidRect.x + avoidRect.width,
            bottom: avoidRect.y + avoidRect.height,
          }))
        : undefined

      const openAsDocument = () => {
        const existingNode =
          nodesRef.current.find(node => {
            if (node.data.kind !== 'document' || !node.data.document) {
              return false
            }

            if (node.data.document.uri !== normalizedUri) {
              return false
            }

            return space.nodeIds.includes(node.id)
          }) ?? null

        if (existingNode) {
          focusNodeInViewport(reactFlow, existingNode, { duration: 120, zoom: reactFlow.getZoom() })
          return
        }

        const created = createDocumentNode(
          placement.anchor,
          { uri: normalizedUri },
          {
            targetSpaceRect: rect,
            preferredDirection: options?.explorerPlacementPx ? 'right' : undefined,
            avoidRects: placement.avoidRects,
          },
        )

        if (!created) {
          return
        }

        if (preferRightPlacement) {
          const desired = placement.anchor
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
      }

      if (mimeType) {
        void (async () => {
          const filesystem = window.opencoveApi?.filesystem
          const workspace = window.opencoveApi?.workspace
          if (!filesystem || typeof filesystem.readFileBytes !== 'function') {
            openAsDocument()
            return
          }
          if (!workspace || typeof workspace.writeCanvasImage !== 'function') {
            openAsDocument()
            return
          }

          try {
            const { bytes } = await filesystem.readFileBytes({ uri: normalizedUri })
            const assetId = crypto.randomUUID()
            const fileName = resolveFileNameFromFileUri(normalizedUri)

            await workspace.writeCanvasImage({ assetId, bytes, mimeType, fileName })
            const { naturalWidth, naturalHeight } = await readImageNaturalDimensions(
              bytes,
              mimeType,
            )

            const created = createImageNode(
              placement.anchor,
              {
                assetId,
                mimeType,
                fileName,
                naturalWidth,
                naturalHeight,
              },
              {
                targetSpaceRect: rect,
                preferredDirection: options?.explorerPlacementPx ? 'right' : undefined,
                avoidRects: placement.avoidRects,
              },
            )

            if (!created) {
              return
            }

            if (preferRightPlacement) {
              const desired = placement.anchor
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
          } catch {
            openAsDocument()
          }
        })()
        return
      }

      openAsDocument()
    },
    [
      canvasRef,
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

  return {
    openExplorerSpaceId,
    explorerClipboard,
    openSpaceExplorer,
    closeSpaceExplorer,
    toggleSpaceExplorer,
    setExplorerClipboard,
    findBlockingOpenDocument,
    openFileInSpace,
  }
}
