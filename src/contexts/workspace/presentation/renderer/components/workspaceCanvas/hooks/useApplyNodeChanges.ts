import { useCallback, useRef } from 'react'
import { applyNodeChanges } from '@xyflow/react'
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
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
import { projectWorkspaceNodeDropLayout } from './useSpaceOwnership.projectDropLayout'

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
      } else if (wasDragging && !isDraggingThisFrame) {
        dragBaselinePositionByIdRef.current = null

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
      const activeSelectedSpaceIds = dragSelectedSpaceIdsRef?.current ?? selectedSpaceIdsRef.current
      const hasSelectedSpaces = activeSelectedSpaceIds.length > 0
      const prevAnchor = anchorChange
        ? (currentNodes.find(node => node.id === anchorChange.id) ?? null)
        : null
      const anchorIsSelected = prevAnchor?.selected === true
      const shouldSyncSelectedSpaces =
        hasSelectedSpaces && anchorChange !== null && anchorIsSelected
      let syncedSelectedSpaceOwnedNodeIds: Set<string> | null = null

      if (shouldSyncSelectedSpaces) {
        const selectedSpaceIdSet = new Set(activeSelectedSpaceIds)
        const previousSpaces = spacesRef.current
        const draggedNodeIds = new Set(positionChanges.map(change => change.id))
        const ownedNodeIdsToShift = new Set<string>()

        for (const space of previousSpaces) {
          if (!selectedSpaceIdSet.has(space.id) || !space.rect) {
            continue
          }

          for (const nodeId of space.nodeIds) {
            if (draggedNodeIds.has(nodeId)) {
              continue
            }

            ownedNodeIdsToShift.add(nodeId)
          }
        }

        syncedSelectedSpaceOwnedNodeIds = ownedNodeIdsToShift.size > 0 ? ownedNodeIdsToShift : null

        const nextAnchor = nextNodes.find(node => node.id === anchorChange.id) ?? null

        if (prevAnchor && nextAnchor) {
          const dx = nextAnchor.position.x - prevAnchor.position.x
          const dy = nextAnchor.position.y - prevAnchor.position.y

          if (dx !== 0 || dy !== 0) {
            const movedSpaceIds = new Set<string>()
            let hasSpaceMoved = false

            const nextSpaces = previousSpaces.map(space => {
              if (!selectedSpaceIdSet.has(space.id) || !space.rect) {
                return space
              }

              movedSpaceIds.add(space.id)

              const nextRect = {
                ...space.rect,
                x: space.rect.x + dx,
                y: space.rect.y + dy,
              }

              if (
                nextRect.x === space.rect.x &&
                nextRect.y === space.rect.y &&
                nextRect.width === space.rect.width &&
                nextRect.height === space.rect.height
              ) {
                return space
              }

              hasSpaceMoved = true
              return {
                ...space,
                rect: nextRect,
              }
            })

            if (hasSpaceMoved) {
              spacesRef.current = nextSpaces
              onSpacesChange(nextSpaces)
              onRequestPersistFlush?.()
            }

            if (syncedSelectedSpaceOwnedNodeIds && movedSpaceIds.size > 0) {
              const shiftNodeIds = syncedSelectedSpaceOwnedNodeIds
              nextNodes = nextNodes.map(node => {
                if (!shiftNodeIds.has(node.id)) {
                  return node
                }

                const nextPosition = {
                  x: node.position.x + dx,
                  y: node.position.y + dy,
                }

                if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
                  return node
                }

                return {
                  ...node,
                  position: nextPosition,
                }
              })
            }
          }
        }
      }

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

        const baselineNodes = buildDragBaselineNodes({
          nodes: nextNodes,
          baselinePositionById,
          shiftNodeIds: syncedSelectedSpaceOwnedNodeIds,
          shiftDx: dragDx,
          shiftDy: dragDy,
        })

        const projected = projectWorkspaceNodeDropLayout({
          nodes: baselineNodes,
          spaces: spacesRef.current,
          draggedNodeIds,
          draggedNodePositionById: desiredDraggedPositionById,
          dragDx,
          dragDy,
          dropFlowPoint,
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
        window.dispatchEvent(new Event('cove:terminal-layout-sync'))
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
