import { useCallback, useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import { resolveWorkspaceSnap } from '../../../utils/workspaceSnap'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import { areSpaceRectsEqual, buildDragBaselineNodes } from './useApplyNodeChanges.helpers'
import { projectWorkspaceSpaceDominantLayout } from './useApplyNodeChanges.spaceDominant'
import {
  projectCanvasInteractionDrop,
  readCanvasInteractionState,
} from './useNodeDragSession.collapse'
import { projectCanvasInteractionLayout } from '../../../utils/canvasInteractionLayout'
import { resolveSpaceAtPoint } from './useSpaceOwnership.drop.helpers'
import {
  buildDraggedNodeKey,
  readDragLayoutTimeMs,
  resolveDragLayoutAnchorPoint,
  shouldResolveLiveDragSecondaryProjection,
  type DragLayoutProjectionInput,
  type DragLayoutProjectionResult,
  type LastLiveDragSecondaryProjection,
} from './useNodeDragSession.liveProjection'
import type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession.types'
import {
  useCanvasDocumentCommands,
  useCanvasInteractionCommands,
  useReadCanvasDocument,
  useReadCanvasInteraction,
  useReadCanvasSelection,
} from '../../../store/canvasStoreContext'
export type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession.types'

/** The Spaces with the rects of a released frame; the same array when no rect changes. */
function applySpaceFramePreview(
  spaces: WorkspaceSpaceState[],
  preview: ReadonlyMap<string, WorkspaceSpaceRect>,
): WorkspaceSpaceState[] {
  let hasSpaceChange = false
  const nextSpaces = spaces.map(space => {
    const rect = preview.get(space.id) ?? null
    if (!rect) {
      return space
    }

    if (space.rect && areSpaceRectsEqual(space.rect, rect)) {
      return space
    }

    hasSpaceChange = true
    return { ...space, rect: { ...rect } }
  })

  return hasSpaceChange ? nextSpaces : spaces
}

export function useWorkspaceCanvasNodeDragSession({
  workspaceId,
}: {
  workspaceId: string
}): WorkspaceCanvasNodeDragSession {
  const readSelection = useReadCanvasSelection()
  const readDocument = useReadCanvasDocument()
  const readInteraction = useReadCanvasInteraction()
  const documentCommands = useCanvasDocumentCommands()
  const { setSnapGuides, setNodeDragFramePreview } = useCanvasInteractionCommands()
  // Private to the session: written once per drag, read per frame, never rendered.
  const dragStartSpaceIdsRef = useRef<readonly string[] | null>(null)
  const nodeDragPointerAnchorRef = useRef<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>(null)
  // The frame preview of an ordinary node drop is visual-only and lives in the canvas store
  // (`setNodeDragFramePreview`); ownership always recomputes from durable Spaces.
  const dragBaselinePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragBaselineSpaceRectByIdRef = useRef<Map<string, WorkspaceSpaceRect> | null>(null)
  const dragSpaceDominantRef = useRef(false)
  const dragSpaceFramePreviewRef = useRef<ReadonlyMap<string, WorkspaceSpaceRect> | null>(null)
  const committableSpaceFramePreviewRef = useRef<ReadonlyMap<string, WorkspaceSpaceRect> | null>(
    null,
  )
  const pendingReleasePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const latestDragLayoutProjectionInputRef = useRef<DragLayoutProjectionInput | null>(null)
  const lastLiveDragSecondaryProjectionRef = useRef<LastLiveDragSecondaryProjection | null>(null)

  const resetLiveDragLayoutProjection = useCallback(() => {
    latestDragLayoutProjectionInputRef.current = null
    lastLiveDragSecondaryProjectionRef.current = null
  }, [])

  const resolveDragLayoutProjection = useCallback(
    (
      {
        currentNodes,
        draggedNodeIds,
        desiredDraggedPositionById,
        dropFlowPoint,
        anchorNodeId,
        anchorIsSelected,
      }: DragLayoutProjectionInput,
      strategy: 'primary' | 'live' | 'final',
    ): DragLayoutProjectionResult => {
      const baselinePositionById = dragBaselinePositionByIdRef.current
      const baselineSpaceRectById = dragBaselineSpaceRectByIdRef.current
      const resolvedAnchorNodeId = anchorNodeId ?? draggedNodeIds[0] ?? null
      const baselineAnchor = resolvedAnchorNodeId
        ? (baselinePositionById?.get(resolvedAnchorNodeId) ?? null)
        : null
      const desiredAnchor = resolvedAnchorNodeId
        ? (desiredDraggedPositionById.get(resolvedAnchorNodeId) ?? null)
        : null
      const dragDx = baselineAnchor && desiredAnchor ? desiredAnchor.x - baselineAnchor.x : 0
      const dragDy = baselineAnchor && desiredAnchor ? desiredAnchor.y - baselineAnchor.y : 0
      const activeSelectedSpaceIds = dragStartSpaceIdsRef.current ?? readSelection().spaceIds
      // One read for the whole frame: nothing writes the store between the branches.
      const { spaces } = readDocument()

      const shouldUseSpaceDominantProjection =
        dragSpaceDominantRef.current &&
        activeSelectedSpaceIds.length > 0 &&
        anchorIsSelected &&
        Boolean(baselinePositionById) &&
        Boolean(baselineSpaceRectById)

      if (shouldUseSpaceDominantProjection && baselinePositionById && baselineSpaceRectById) {
        const projected = projectWorkspaceSpaceDominantLayout({
          nodes: currentNodes,
          spaces,
          baselineNodePositionById: baselinePositionById,
          baselineSpaceRectById,
          desiredDraggedPositionById,
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
        committableSpaceFramePreviewRef.current = projected.nextSpaceFramePreview
        setNodeDragFramePreview(projected.nextSpaceFramePreview)
        pendingReleasePositionByIdRef.current = null

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

      // Ordinary node previews are visual-only and can never be committed as a
      // Space-dominant frame, even if selection changes during the drag.
      committableSpaceFramePreviewRef.current = null
      const baselineNodes = buildDragBaselineNodes({
        nodes: currentNodes,
        baselinePositionById,
        shiftNodeIds: null,
      })

      const projected = projectCanvasInteractionDrop(
        {
          nodes: baselineNodes,
          spaces,
          draggedNodeIds,
          draggedNodePositionById: desiredDraggedPositionById,
          dragDx,
          dragDy,
          dropFlowPoint,
        },
        workspaceId,
        strategy,
      )

      const nextNodes = currentNodes.map(node => {
        const nextPosition = projected.nextNodePositionById.get(node.id)
        return nextPosition ? { ...node, position: nextPosition } : node
      })

      const currentRectsById = new Map(
        spaces.filter(space => Boolean(space.rect)).map(space => [space.id, space.rect!] as const),
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

      const nextSpaceFramePreview =
        strategy === 'primary'
          ? dragSpaceFramePreviewRef.current
          : hasChanged
            ? new Map(
                projected.nextSpaces
                  .filter(space => Boolean(space.rect))
                  .map(space => [space.id, space.rect!] as const),
              )
            : null

      if (strategy !== 'primary') {
        dragSpaceFramePreviewRef.current = nextSpaceFramePreview
        committableSpaceFramePreviewRef.current = null
        setNodeDragFramePreview(nextSpaceFramePreview)
      }

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
    [readDocument, readSelection, setNodeDragFramePreview, workspaceId],
  )

  const clearNodeDragProjection = useCallback(() => {
    dragSpaceFramePreviewRef.current = null
    committableSpaceFramePreviewRef.current = null
    pendingReleasePositionByIdRef.current = null
    resetLiveDragLayoutProjection()
    setSnapGuides(null)
    setNodeDragFramePreview(null)
  }, [resetLiveDragLayoutProjection, setNodeDragFramePreview, setSnapGuides])

  const beginNodeDragSession = useCallback(
    (currentNodes: Node<TerminalNodeData>[]) => {
      dragBaselinePositionByIdRef.current = new Map(
        currentNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
      )
      dragBaselineSpaceRectByIdRef.current = new Map(
        readDocument()
          .spaces.filter(space => Boolean(space.rect))
          .map(space => [space.id, { ...space.rect! }] as const),
      )
      const selectedSpaceIdsAtStart = dragStartSpaceIdsRef.current ?? readSelection().spaceIds
      dragSpaceDominantRef.current = selectedSpaceIdsAtStart.length > 0
      dragSpaceFramePreviewRef.current = null
      committableSpaceFramePreviewRef.current = null
      pendingReleasePositionByIdRef.current = null
      resetLiveDragLayoutProjection()
    },
    [readDocument, readSelection, resetLiveDragLayoutProjection],
  )

  const projectNodeDrag = useCallback(
    ({
      currentNodes,
      draggedNodeIds,
      desiredDraggedPositionById,
      dropFlowPoint = null,
      anchorNodeId = null,
      anchorIsSelected = false,
    }: Parameters<WorkspaceCanvasNodeDragSession['projectNodeDrag']>[0]) => {
      const nextDraggedPositionById = desiredDraggedPositionById
      const interaction = projectCanvasInteractionLayout(
        currentNodes,
        readDocument().spaces,
        readCanvasInteractionState(workspaceId),
      )
      let pendingReleasePositionById: Map<string, { x: number; y: number }> | null = null
      if (draggedNodeIds.length > 0 && readInteraction().magneticSnappingEnabled) {
        const snappedNodes = interaction.nodes.map(node => {
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
              spaces: interaction.spaces,
            }),
            grid: WORKSPACE_ARRANGE_GRID_PX,
            threshold: 8,
            enableGrid: true,
            enableObject: true,
          })
          setSnapGuides(snapped.guides.length > 0 ? snapped.guides : null)

          if (snapped.dx !== 0 || snapped.dy !== 0) {
            pendingReleasePositionById = new Map(
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
          setSnapGuides(null)
        }
      } else {
        setSnapGuides(null)
      }

      pendingReleasePositionByIdRef.current = pendingReleasePositionById

      const projectionInput: DragLayoutProjectionInput = {
        currentNodes,
        draggedNodeIds,
        desiredDraggedPositionById: nextDraggedPositionById,
        dropFlowPoint,
        anchorNodeId,
        anchorIsSelected,
      }
      latestDragLayoutProjectionInputRef.current = projectionInput

      const draggedNodeKey = buildDraggedNodeKey(draggedNodeIds)
      const anchorPoint = resolveDragLayoutAnchorPoint({
        anchorNodeId,
        draggedNodeIds,
        desiredDraggedPositionById: nextDraggedPositionById,
      })
      const nowMs = readDragLayoutTimeMs()
      const draggedNodeIdSet = new Set(draggedNodeIds)
      const desiredDraggedNodes = interaction.nodes.flatMap(node => {
        if (!draggedNodeIdSet.has(node.id)) {
          return []
        }

        const desiredPosition = nextDraggedPositionById.get(node.id)
        return desiredPosition ? [{ ...node, position: desiredPosition }] : []
      })
      const desiredDraggedRect = unionWorkspaceNodeRects(desiredDraggedNodes)
      const targetPoint =
        draggedNodeIds.length === 1 &&
        dropFlowPoint &&
        Number.isFinite(dropFlowPoint.x) &&
        Number.isFinite(dropFlowPoint.y)
          ? dropFlowPoint
          : desiredDraggedRect
            ? {
                x: desiredDraggedRect.x + desiredDraggedRect.width * 0.5,
                y: desiredDraggedRect.y + desiredDraggedRect.height * 0.5,
              }
            : null
      const targetSpaceId = targetPoint
        ? (resolveSpaceAtPoint(interaction.spaces, targetPoint)?.id ?? null)
        : null
      const shouldResolveSecondary = shouldResolveLiveDragSecondaryProjection({
        lastProjection: lastLiveDragSecondaryProjectionRef.current,
        draggedNodeKey,
        anchorPoint,
        nowMs,
        targetSpaceId,
      })

      if (shouldResolveSecondary) {
        lastLiveDragSecondaryProjectionRef.current = {
          anchorPoint: anchorPoint ? { ...anchorPoint } : null,
          draggedNodeKey,
          projectedAtMs: nowMs,
          targetSpaceId,
        }
      }

      // Never skip primary: deferred peer layout must not expose raw edge-crossing positions.
      return resolveDragLayoutProjection(
        projectionInput,
        shouldResolveSecondary ? 'live' : 'primary',
      )
    },
    [readDocument, readInteraction, resolveDragLayoutProjection, setSnapGuides, workspaceId],
  )

  const applyPendingReleaseProjection = useCallback(
    (currentNodes: Node<TerminalNodeData>[]) => {
      const pending = pendingReleasePositionByIdRef.current
      const releaseNodes =
        pending && pending.size > 0
          ? currentNodes.map(node => {
              const nextPosition = pending.get(node.id)
              return nextPosition ? { ...node, position: nextPosition } : node
            })
          : currentNodes

      const latestInput = latestDragLayoutProjectionInputRef.current
      if (!latestInput || latestInput.draggedNodeIds.length === 0) {
        return releaseNodes
      }

      const nodeById = new Map(releaseNodes.map(node => [node.id, node]))
      const desiredDraggedPositionById = new Map<string, { x: number; y: number }>()
      for (const nodeId of latestInput.draggedNodeIds) {
        const node = nodeById.get(nodeId)
        const fallbackPosition = latestInput.desiredDraggedPositionById.get(nodeId)
        const position = node?.position ?? fallbackPosition ?? null
        if (!position) {
          continue
        }

        desiredDraggedPositionById.set(nodeId, { x: position.x, y: position.y })
      }

      const finalProjection = resolveDragLayoutProjection(
        {
          ...latestInput,
          currentNodes: releaseNodes,
          desiredDraggedPositionById,
        },
        'final',
      )
      return finalProjection.nextNodes
    },
    [resolveDragLayoutProjection],
  )

  const captureDragStartSpaceSelection = useCallback(() => {
    dragStartSpaceIdsRef.current = readSelection().spaceIds
  }, [readSelection])

  const getDragStartSpaceSelection = useCallback(() => dragStartSpaceIdsRef.current, [])

  const clearDragStartSpaceSelection = useCallback(() => {
    dragStartSpaceIdsRef.current = null
  }, [])

  const endNodeDragSession = useCallback(() => {
    if (dragSpaceDominantRef.current && committableSpaceFramePreviewRef.current) {
      const rectOverrideById = committableSpaceFramePreviewRef.current
      // `updateSpaces` flushes also when nothing changed, and a release that moves no rect must
      // not flush: decide first, from the committed Spaces, then write from the recipe's own.
      const { spaces } = readDocument()
      if (applySpaceFramePreview(spaces, rectOverrideById) !== spaces) {
        documentCommands.updateSpaces(
          currentSpaces => applySpaceFramePreview(currentSpaces, rectOverrideById),
          { flush: true },
        )
      }
    }

    dragBaselinePositionByIdRef.current = null
    dragBaselineSpaceRectByIdRef.current = null
    dragSpaceDominantRef.current = false
    clearNodeDragProjection()
  }, [clearNodeDragProjection, documentCommands, readDocument])

  useEffect(() => {
    nodeDragPointerAnchorRef.current = null
    dragBaselinePositionByIdRef.current = null
    dragBaselineSpaceRectByIdRef.current = null
    dragSpaceDominantRef.current = false
    clearNodeDragProjection()
  }, [clearNodeDragProjection, workspaceId])

  return {
    nodeDragPointerAnchorRef,
    dragBaselinePositionByIdRef,
    dragBaselineSpaceRectByIdRef,
    beginNodeDragSession,
    projectNodeDrag,
    applyPendingReleaseProjection,
    endNodeDragSession,
    clearNodeDragProjection,
    captureDragStartSpaceSelection,
    getDragStartSpaceSelection,
    clearDragStartSpaceSelection,
  }
}
