import { useCallback, useRef } from 'react'
import { applyNodeChanges } from '@xyflow/react'
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceRect } from '../../../types'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../terminalNode/constants'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import { resolveWorkspaceSnap } from '../../../utils/workspaceSnap'
import {
  areSpaceRectsEqual,
  buildDragBaselineNodes,
  setResolvedSnapGuides,
  setResolvedSpaceFramePreview,
  type UseApplyNodeChangesParams,
} from './useApplyNodeChanges.helpers'
import {
  projectWorkspaceNodeDropLayout,
  type WorkspaceNodeDropProjectionCache,
} from './useSpaceOwnership.projectDropLayout'
import { projectWorkspaceSpaceDominantLayout } from './useApplyNodeChanges.spaceDominant'

export function useWorkspaceCanvasApplyNodeChanges({
  nodesRef,
  onNodesChange,
  clearAgentLaunchToken,
  normalizePosition,
  applyPendingScrollbacks,
  isNodeDraggingRef,
  spacesRef,
  selectedSpaceIdsRef,
  dragSelectedSpaceIdsRef,
  magneticSnappingEnabledRef,
  setSnapGuides,
  exclusiveNodeDragAnchorIdRef,
  onSpacesChange,
  onRequestPersistFlush,
  setSpaceFramePreview,
  nodeDragPointerAnchorRef,
}: UseApplyNodeChangesParams): (changes: NodeChange<Node<TerminalNodeData>>[]) => void {
  const dragBaselinePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragDropProjectionCacheRef = useRef<WorkspaceNodeDropProjectionCache | null>(null)
  const dragBaselineSpaceRectByIdRef = useRef<Map<string, WorkspaceSpaceRect> | null>(null)
  const dragSpaceDominantRef = useRef(false)
  const dragSpaceFramePreviewRef = useRef<ReadonlyMap<string, WorkspaceSpaceRect> | null>(null)

  return useCallback(
    (changes: NodeChange<Node<TerminalNodeData>>[]) => {
      const wasDragging = isNodeDraggingRef.current
      const exclusiveAnchorId = exclusiveNodeDragAnchorIdRef?.current ?? null
      const filteredChanges = changes
        .filter(change => change.type !== 'select')
        .filter(change => {
          if (!exclusiveAnchorId) {
            return true
          }

          return change.type !== 'position' || change.id === exclusiveAnchorId
        })

      if (!filteredChanges.length) {
        return
      }

      const currentNodes = nodesRef.current
      const removedIds = new Set(
        filteredChanges.filter(change => change.type === 'remove').map(change => change.id),
      )

      if (removedIds.size > 0) {
        removedIds.forEach(removedId => {
          clearAgentLaunchToken(removedId)
        })

        currentNodes.forEach(node => {
          if (!removedIds.has(node.id)) {
            return
          }

          if (node.data.sessionId.length > 0) {
            cleanupNodeRuntimeArtifacts(node.id, node.data.sessionId)
            void window.opencoveApi.pty
              .kill({ sessionId: node.data.sessionId })
              .catch(() => undefined)
          }
        })
      }

      const survivingNodes = currentNodes.filter(node => !removedIds.has(node.id))
      const nonRemoveChanges = filteredChanges.filter(change => change.type !== 'remove')

      let nextNodes = applyNodeChanges<Node<TerminalNodeData>>(nonRemoveChanges, survivingNodes)

      const positionChanges = filteredChanges.filter(
        (change): change is NodePositionChange =>
          change.type === 'position' && !removedIds.has(change.id),
      )
      const isDraggingThisFrame = positionChanges.some(change => change.dragging !== false)
      const movedNodeIds = new Set(
        positionChanges.filter(change => change.position !== undefined).map(change => change.id),
      )

      const settledPositionChanges: NodePositionChange[] = filteredChanges.filter(
        (change): change is NodePositionChange =>
          change.type === 'position' &&
          change.dragging === false &&
          change.position !== undefined &&
          !removedIds.has(change.id),
      )

      if (movedNodeIds.size > 0 && magneticSnappingEnabledRef.current) {
        const movingNodes = nextNodes.filter(node => movedNodeIds.has(node.id))
        const movingRect = unionWorkspaceNodeRects(movingNodes)

        if (movingRect) {
          const snapped = resolveWorkspaceSnap({
            movingRect,
            candidateRects: resolveWorkspaceNodeSnapCandidateRects({
              movingNodeIds: movedNodeIds,
              nodes: nextNodes,
              spaces: spacesRef.current,
            }),
            grid: WORKSPACE_ARRANGE_GRID_PX,
            threshold: 8,
            enableGrid: true,
            enableObject: true,
          })

          if (isDraggingThisFrame) {
            setResolvedSnapGuides(setSnapGuides, snapped.guides.length > 0 ? snapped.guides : null)
          } else if (snapped.dx !== 0 || snapped.dy !== 0) {
            nextNodes = nextNodes.map(node =>
              movedNodeIds.has(node.id)
                ? {
                    ...node,
                    position: {
                      x: node.position.x + snapped.dx,
                      y: node.position.y + snapped.dy,
                    },
                  }
                : node,
            )
          }

          if (!isDraggingThisFrame) {
            setResolvedSnapGuides(setSnapGuides, null)
          }
        } else {
          setResolvedSnapGuides(setSnapGuides, null)
        }
      } else if (positionChanges.length > 0) {
        setResolvedSnapGuides(setSnapGuides, null)
      }

      if (!wasDragging && isDraggingThisFrame) {
        dragBaselinePositionByIdRef.current = new Map(
          currentNodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
        )
        dragBaselineSpaceRectByIdRef.current = new Map(
          spacesRef.current
            .filter(space => Boolean(space.rect))
            .map(space => [space.id, { ...space.rect! }] as const),
        )
        const selectedSpaceIdsAtStart =
          dragSelectedSpaceIdsRef?.current ?? selectedSpaceIdsRef.current
        dragSpaceDominantRef.current = selectedSpaceIdsAtStart.length > 0
        dragSpaceFramePreviewRef.current = null
        dragDropProjectionCacheRef.current = null
      } else if (wasDragging && !isDraggingThisFrame) {
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
        dragSpaceFramePreviewRef.current = null
        dragDropProjectionCacheRef.current = null

        if (setSpaceFramePreview) {
          window.requestAnimationFrame(() => {
            setResolvedSpaceFramePreview(setSpaceFramePreview, null)
          })
        }
      }

      if (settledPositionChanges.length > 0) {
        if (!wasDragging) {
          nextNodes = nextNodes.map(node => {
            const settledChange = settledPositionChanges.find(change => change.id === node.id)
            if (!settledChange || !settledChange.position) {
              return node
            }

            const resolved = normalizePosition(node.id, settledChange.position, {
              width: node.data.width,
              height: node.data.height,
            })

            return {
              ...node,
              position: resolved,
            }
          })
        }
      }

      const anchorChange = positionChanges.find(change => change.position !== undefined) ?? null

      if (isDraggingThisFrame) {
        const draggingIds = positionChanges
          .filter(change => change.dragging !== false)
          .map(change => change.id)
        const draggedNodeIds = [...new Set(draggingIds)]

        const desiredDraggedPositionById = new Map<string, { x: number; y: number }>()
        for (const nodeId of draggedNodeIds) {
          const node = nextNodes.find(candidate => candidate.id === nodeId)
          if (!node) {
            continue
          }

          desiredDraggedPositionById.set(nodeId, {
            x: node.position.x,
            y: node.position.y,
          })
        }

        const anchorNodeId =
          positionChanges.find(change => change.dragging !== false && change.position !== undefined)
            ?.id ?? draggedNodeIds[0]
        const baselinePositionById = dragBaselinePositionByIdRef.current
        const baselineAnchor = baselinePositionById?.get(anchorNodeId ?? '') ?? null
        const desiredAnchor = anchorNodeId
          ? (desiredDraggedPositionById.get(anchorNodeId) ?? null)
          : null
        const dragDx = baselineAnchor && desiredAnchor ? desiredAnchor.x - baselineAnchor.x : 0
        const dragDy = baselineAnchor && desiredAnchor ? desiredAnchor.y - baselineAnchor.y : 0

        const dropFlowPoint =
          draggedNodeIds.length === 1 &&
          nodeDragPointerAnchorRef?.current?.nodeId === draggedNodeIds[0] &&
          desiredDraggedPositionById.get(draggedNodeIds[0])
            ? (() => {
                const anchor = nodeDragPointerAnchorRef.current!
                const desired = desiredDraggedPositionById.get(draggedNodeIds[0])!
                return { x: desired.x + anchor.offset.x, y: desired.y + anchor.offset.y }
              })()
            : null

        const activeSelectedSpaceIds =
          dragSelectedSpaceIdsRef?.current ?? selectedSpaceIdsRef.current
        const hasSelectedSpaces = activeSelectedSpaceIds.length > 0
        const prevAnchor = anchorChange
          ? (currentNodes.find(node => node.id === anchorChange.id) ?? null)
          : null
        const anchorIsSelected = prevAnchor?.selected === true
        const baselineSpaceRectById = dragBaselineSpaceRectByIdRef.current

        const shouldUseSpaceDominantProjection =
          dragSpaceDominantRef.current &&
          hasSelectedSpaces &&
          anchorIsSelected &&
          Boolean(baselinePositionById) &&
          Boolean(baselineSpaceRectById) &&
          Boolean(setSpaceFramePreview)

        if (
          shouldUseSpaceDominantProjection &&
          baselinePositionById &&
          baselineSpaceRectById &&
          setSpaceFramePreview
        ) {
          dragDropProjectionCacheRef.current = null

          const projected = projectWorkspaceSpaceDominantLayout({
            nodes: nextNodes,
            spaces: spacesRef.current,
            baselineNodePositionById: baselinePositionById,
            baselineSpaceRectById,
            desiredDraggedPositionById,
            draggedNodeIds,
            selectedSpaceIds: activeSelectedSpaceIds,
            dragDx,
            dragDy,
          })

          nextNodes = nextNodes.map(node => {
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

          const nextPreview = projected.nextSpaceFramePreview
          dragSpaceFramePreviewRef.current = nextPreview
          setResolvedSpaceFramePreview(setSpaceFramePreview, nextPreview)
        } else {
          const baselineNodes = buildDragBaselineNodes({
            nodes: nextNodes,
            baselinePositionById,
            shiftNodeIds: null,
            shiftDx: 0,
            shiftDy: 0,
          })

          const projected = projectWorkspaceNodeDropLayout({
            nodes: baselineNodes,
            spaces: spacesRef.current,
            draggedNodeIds,
            draggedNodePositionById: desiredDraggedPositionById,
            dragDx,
            dragDy,
            dropFlowPoint,
            previousCache: dragDropProjectionCacheRef.current,
          })
          dragDropProjectionCacheRef.current = projected.nextCache

          nextNodes = nextNodes.map(node => {
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

          if (setSpaceFramePreview) {
            const currentRectsById = new Map(
              spacesRef.current
                .filter(space => Boolean(space.rect))
                .map(space => [space.id, space.rect!]),
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

            const nextPreview = hasChanged
              ? new Map(
                  projected.nextSpaces
                    .filter(space => Boolean(space.rect))
                    .map(space => [space.id, space.rect!] as const),
                )
              : null

            setResolvedSpaceFramePreview(setSpaceFramePreview, nextPreview)
          }
        }
      }

      if (positionChanges.length > 0) {
        isNodeDraggingRef.current = isDraggingThisFrame
      }

      if (
        exclusiveAnchorId &&
        exclusiveNodeDragAnchorIdRef &&
        positionChanges.length > 0 &&
        !isDraggingThisFrame
      ) {
        exclusiveNodeDragAnchorIdRef.current = null
      }

      if (!isNodeDraggingRef.current) {
        nextNodes = applyPendingScrollbacks(nextNodes)
      }

      if (removedIds.size > 0) {
        const now = new Date().toISOString()

        nextNodes = nextNodes.map(node => {
          if (
            node.data.kind === 'task' &&
            node.data.task &&
            node.data.task.linkedAgentNodeId &&
            removedIds.has(node.data.task.linkedAgentNodeId)
          ) {
            return {
              ...node,
              data: {
                ...node.data,
                task: {
                  ...node.data.task,
                  linkedAgentNodeId: null,
                  status: node.data.task.status === 'doing' ? 'todo' : node.data.task.status,
                  updatedAt: now,
                },
              },
            }
          }

          if (
            node.data.kind === 'agent' &&
            node.data.agent &&
            node.data.agent.taskId &&
            removedIds.has(node.data.agent.taskId)
          ) {
            return {
              ...node,
              data: {
                ...node.data,
                agent: {
                  ...node.data.agent,
                  taskId: null,
                },
              },
            }
          }

          return node
        })
      }

      const shouldSyncLayout = filteredChanges.some(change => {
        if (change.type === 'remove') {
          return true
        }

        if (change.type === 'position') {
          return change.dragging === false
        }

        return true
      })

      nodesRef.current = nextNodes
      onNodesChange(nextNodes)
      if (shouldSyncLayout) {
        window.dispatchEvent(new Event(TERMINAL_LAYOUT_SYNC_EVENT))
      }
    },
    [
      applyPendingScrollbacks,
      clearAgentLaunchToken,
      exclusiveNodeDragAnchorIdRef,
      isNodeDraggingRef,
      nodesRef,
      normalizePosition,
      magneticSnappingEnabledRef,
      nodeDragPointerAnchorRef,
      onNodesChange,
      onRequestPersistFlush,
      onSpacesChange,
      setSnapGuides,
      setSpaceFramePreview,
      dragSelectedSpaceIdsRef,
      selectedSpaceIdsRef,
      spacesRef,
    ],
  )
}
