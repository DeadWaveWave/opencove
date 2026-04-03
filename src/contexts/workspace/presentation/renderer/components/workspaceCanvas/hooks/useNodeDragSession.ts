import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import { resolveWorkspaceSnap, type WorkspaceSnapGuide } from '../../../utils/workspaceSnap'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import {
  areSpaceRectsEqual,
  buildDragBaselineNodes,
  setResolvedSnapGuides,
  setResolvedSpaceFramePreview,
} from './useApplyNodeChanges.helpers'
import { projectWorkspaceSpaceDominantLayout } from './useApplyNodeChanges.spaceDominant'
import { projectWorkspaceNodeDropLayout } from './useSpaceOwnership.projectDropLayout'

export interface WorkspaceCanvasNodeDragSession {
  nodeDragPointerAnchorRef: React.MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
  nodeSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  nodeSpaceFramePreviewRef: React.MutableRefObject<ReadonlyMap<string, WorkspaceSpaceRect> | null>
  dragBaselinePositionByIdRef: React.MutableRefObject<Map<string, { x: number; y: number }> | null>
  dragBaselineSpaceRectByIdRef: React.MutableRefObject<Map<string, WorkspaceSpaceRect> | null>
  beginNodeDragSession: (currentNodes: Node<TerminalNodeData>[]) => void
  projectNodeDrag: (options: {
    currentNodes: Node<TerminalNodeData>[]
    draggedNodeIds: string[]
    desiredDraggedPositionById: Map<string, { x: number; y: number }>
    dropFlowPoint?: { x: number; y: number } | null
    anchorNodeId?: string | null
    anchorIsSelected?: boolean
  }) => {
    nextNodes: Node<TerminalNodeData>[]
    nextDraggedNodePositionById: Map<string, { x: number; y: number }>
    nextSpaceFramePreview: ReadonlyMap<string, WorkspaceSpaceRect> | null
  }
  endNodeDragSession: () => void
  clearNodeDragProjection: () => void
}

export function useWorkspaceCanvasNodeDragSession({
  workspaceId,
  spacesRef,
  selectedSpaceIdsRef,
  dragSelectedSpaceIdsRef,
  magneticSnappingEnabledRef,
  setSnapGuides,
  onSpacesChange,
  onRequestPersistFlush,
}: {
  workspaceId: string
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  dragSelectedSpaceIdsRef: React.MutableRefObject<string[] | null>
  magneticSnappingEnabledRef: React.MutableRefObject<boolean>
  setSnapGuides: React.Dispatch<React.SetStateAction<WorkspaceSnapGuide[] | null>>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}): WorkspaceCanvasNodeDragSession {
  const nodeDragPointerAnchorRef = useRef<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>(null)
  const nodeSpaceFramePreviewRef = useRef<ReadonlyMap<string, WorkspaceSpaceRect> | null>(null)
  const [nodeSpaceFramePreview, setNodeSpaceFramePreview] = useState<ReadonlyMap<
    string,
    WorkspaceSpaceRect
  > | null>(null)
  const dragBaselinePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragBaselineSpaceRectByIdRef = useRef<Map<string, WorkspaceSpaceRect> | null>(null)
  const dragSpaceDominantRef = useRef(false)
  const dragSpaceFramePreviewRef = useRef<ReadonlyMap<string, WorkspaceSpaceRect> | null>(null)

  const setNodeSpaceFramePreviewState = useCallback(
    (updater: React.SetStateAction<ReadonlyMap<string, WorkspaceSpaceRect> | null>) => {
      setNodeSpaceFramePreview(current => {
        const next =
          typeof updater === 'function'
            ? (
                updater as (
                  current: ReadonlyMap<string, WorkspaceSpaceRect> | null,
                ) => ReadonlyMap<string, WorkspaceSpaceRect> | null
              )(current)
            : updater

        nodeSpaceFramePreviewRef.current = next
        return next
      })
    },
    [],
  )

  const clearNodeDragProjection = useCallback(() => {
    dragSpaceFramePreviewRef.current = null
    setResolvedSnapGuides(setSnapGuides, null)
    setResolvedSpaceFramePreview(setNodeSpaceFramePreviewState, null)
  }, [setNodeSpaceFramePreviewState, setSnapGuides])

  const beginNodeDragSession = useCallback(
    (currentNodes: Node<TerminalNodeData>[]) => {
      dragBaselinePositionByIdRef.current = new Map(
        currentNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
      )
      dragBaselineSpaceRectByIdRef.current = new Map(
        spacesRef.current
          .filter(space => Boolean(space.rect))
          .map(space => [space.id, { ...space.rect! }] as const),
      )
      const selectedSpaceIdsAtStart =
        dragSelectedSpaceIdsRef.current ?? selectedSpaceIdsRef.current
      dragSpaceDominantRef.current = selectedSpaceIdsAtStart.length > 0
      dragSpaceFramePreviewRef.current = null
    },
    [dragSelectedSpaceIdsRef, selectedSpaceIdsRef, spacesRef],
  )

  const projectNodeDrag = useCallback(
    ({
      currentNodes,
      draggedNodeIds,
      desiredDraggedPositionById,
      dropFlowPoint = null,
      anchorNodeId = null,
      anchorIsSelected = false,
    }: {
      currentNodes: Node<TerminalNodeData>[]
      draggedNodeIds: string[]
      desiredDraggedPositionById: Map<string, { x: number; y: number }>
      dropFlowPoint?: { x: number; y: number } | null
      anchorNodeId?: string | null
      anchorIsSelected?: boolean
    }) => {
      const baselinePositionById = dragBaselinePositionByIdRef.current
      const baselineSpaceRectById = dragBaselineSpaceRectByIdRef.current

      let nextDraggedPositionById = desiredDraggedPositionById
      if (draggedNodeIds.length > 0 && magneticSnappingEnabledRef.current) {
        const snappedNodes = currentNodes.map(node => {
          const desired = desiredDraggedPositionById.get(node.id)
          return desired ? { ...node, position: desired } : node
        })
        const movingNodeIds = new Set(draggedNodeIds)
        const movingNodes = snappedNodes.filter(node => movingNodeIds.has(node.id))
        const movingRect = unionWorkspaceNodeRects(movingNodes)

        if (movingRect) {
          const snapped = resolveWorkspaceSnap({
            movingRect,
            candidateRects: resolveWorkspaceNodeSnapCandidateRects({
              movingNodeIds,
              nodes: snappedNodes,
              spaces: spacesRef.current,
            }),
            grid: WORKSPACE_ARRANGE_GRID_PX,
            threshold: 8,
            enableGrid: true,
            enableObject: true,
          })
          setResolvedSnapGuides(setSnapGuides, snapped.guides.length > 0 ? snapped.guides : null)

          if (snapped.dx !== 0 || snapped.dy !== 0) {
            nextDraggedPositionById = new Map(
              draggedNodeIds.flatMap(nodeId => {
                const desired = desiredDraggedPositionById.get(nodeId)
                return desired
                  ? [
                      [
                        nodeId,
                        {
                          x: desired.x + snapped.dx,
                          y: desired.y + snapped.dy,
                        },
                      ] as const,
                    ]
                  : []
              }),
            )
          }
        } else {
          setResolvedSnapGuides(setSnapGuides, null)
        }
      } else {
        setResolvedSnapGuides(setSnapGuides, null)
      }

      const resolvedAnchorNodeId = anchorNodeId ?? draggedNodeIds[0] ?? null
      const baselineAnchor =
        resolvedAnchorNodeId ? (baselinePositionById?.get(resolvedAnchorNodeId) ?? null) : null
      const desiredAnchor =
        resolvedAnchorNodeId ? (nextDraggedPositionById.get(resolvedAnchorNodeId) ?? null) : null
      const dragDx = baselineAnchor && desiredAnchor ? desiredAnchor.x - baselineAnchor.x : 0
      const dragDy = baselineAnchor && desiredAnchor ? desiredAnchor.y - baselineAnchor.y : 0
      const activeSelectedSpaceIds =
        dragSelectedSpaceIdsRef.current ?? selectedSpaceIdsRef.current

      const shouldUseSpaceDominantProjection =
        dragSpaceDominantRef.current &&
        activeSelectedSpaceIds.length > 0 &&
        anchorIsSelected &&
        Boolean(baselinePositionById) &&
        Boolean(baselineSpaceRectById)

      if (shouldUseSpaceDominantProjection && baselinePositionById && baselineSpaceRectById) {
        const projected = projectWorkspaceSpaceDominantLayout({
          nodes: currentNodes,
          spaces: spacesRef.current,
          baselineNodePositionById: baselinePositionById,
          baselineSpaceRectById,
          desiredDraggedPositionById: nextDraggedPositionById,
          draggedNodeIds,
          selectedSpaceIds: activeSelectedSpaceIds,
          dragDx,
          dragDy,
        })

        const nextNodes = currentNodes.map(node => {
          const nextPosition = projected.nextNodePositionById.get(node.id)
          return nextPosition ? { ...node, position: nextPosition } : node
        })

        dragSpaceFramePreviewRef.current = projected.nextSpaceFramePreview
        setResolvedSpaceFramePreview(
          setNodeSpaceFramePreviewState,
          projected.nextSpaceFramePreview,
        )

        return {
          nextNodes,
          nextDraggedNodePositionById: new Map(
            draggedNodeIds.flatMap(nodeId => {
              const next = projected.nextNodePositionById.get(nodeId)
              return next ? ([[nodeId, next]] as const) : []
            }),
          ),
          nextSpaceFramePreview: projected.nextSpaceFramePreview,
        }
      }

      const baselineNodes = buildDragBaselineNodes({
        nodes: currentNodes,
        baselinePositionById,
        shiftNodeIds: null,
      })

      const projected = projectWorkspaceNodeDropLayout({
        nodes: baselineNodes,
        spaces: spacesRef.current,
        draggedNodeIds,
        draggedNodePositionById: nextDraggedPositionById,
        dragDx,
        dragDy,
        dropFlowPoint,
      })

      const nextNodes = currentNodes.map(node => {
        const nextPosition = projected.nextNodePositionById.get(node.id)
        return nextPosition ? { ...node, position: nextPosition } : node
      })

      const currentRectsById = new Map(
        spacesRef.current
          .filter(space => Boolean(space.rect))
          .map(space => [space.id, space.rect!] as const),
      )
      let hasChanged = false
      for (const space of projected.nextSpaces) {
        if (!space.rect) {
          continue
        }

        if (!areSpaceRectsEqual(space.rect, currentRectsById.get(space.id) ?? null)) {
          hasChanged = true
          break
        }
      }

      const nextSpaceFramePreview = hasChanged
        ? new Map(
            projected.nextSpaces
              .filter(space => Boolean(space.rect))
              .map(space => [space.id, space.rect!] as const),
          )
        : null

      dragSpaceFramePreviewRef.current = nextSpaceFramePreview
      setResolvedSpaceFramePreview(setNodeSpaceFramePreviewState, nextSpaceFramePreview)

      return {
        nextNodes,
        nextDraggedNodePositionById: new Map(
          draggedNodeIds.flatMap(nodeId => {
            const next = projected.nextNodePositionById.get(nodeId)
            return next ? ([[nodeId, next]] as const) : []
          }),
        ),
        nextSpaceFramePreview,
      }
    },
    [
      dragSelectedSpaceIdsRef,
      magneticSnappingEnabledRef,
      selectedSpaceIdsRef,
      setNodeSpaceFramePreviewState,
      setSnapGuides,
      spacesRef,
    ],
  )

  const endNodeDragSession = useCallback(() => {
    if (dragSpaceDominantRef.current && dragSpaceFramePreviewRef.current) {
      const rectOverrideById = dragSpaceFramePreviewRef.current
      const previousSpaces = spacesRef.current
      let hasSpaceChange = false
      const nextSpaces = previousSpaces.map(space => {
        const rect = rectOverrideById.get(space.id) ?? null
        if (!rect) {
          return space
        }

        if (space.rect && areSpaceRectsEqual(space.rect, rect)) {
          return space
        }

        hasSpaceChange = true
        return { ...space, rect: { ...rect } }
      })

      if (hasSpaceChange) {
        spacesRef.current = nextSpaces
        onSpacesChange(nextSpaces)
        onRequestPersistFlush?.()
      }
    }

    dragBaselinePositionByIdRef.current = null
    dragBaselineSpaceRectByIdRef.current = null
    dragSpaceDominantRef.current = false
    clearNodeDragProjection()
  }, [clearNodeDragProjection, onRequestPersistFlush, onSpacesChange, spacesRef])

  useEffect(() => {
    nodeDragPointerAnchorRef.current = null
    dragBaselinePositionByIdRef.current = null
    dragBaselineSpaceRectByIdRef.current = null
    dragSpaceDominantRef.current = false
    clearNodeDragProjection()
  }, [clearNodeDragProjection, workspaceId])

  return {
    nodeDragPointerAnchorRef,
    nodeSpaceFramePreview,
    nodeSpaceFramePreviewRef,
    dragBaselinePositionByIdRef,
    dragBaselineSpaceRectByIdRef,
    beginNodeDragSession,
    projectNodeDrag,
    endNodeDragSession,
    clearNodeDragProjection,
  }
}
