import { useCallback, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { validateSpaceTransfer } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
import {
  buildDraggedNodesForTarget,
  collectDraggedNodePositions,
  reassignNodesAcrossSpaces,
  resolveSpaceAtPoint,
} from './useSpaceOwnership.drop.helpers'
import {
  applyDirectoryExpectationForDrop,
  computeBoundingRect,
  computePushedPositionsToClearPinnedNodes,
  inflateRect,
  resolveDeltaToKeepRectInsideRect,
  resolveDeltaToKeepRectOutsideRects,
  resolveNearestNonOverlappingDropOffset,
  restoreSelectionAfterDrop,
  type SetNodes,
} from './useSpaceOwnership.helpers'

export function useWorkspaceCanvasSpaceOwnership({
  workspacePath,
  reactFlow,
  spacesRef,
  selectedSpaceIdsRef,
  dragSelectedSpaceIdsRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
}: {
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  dragSelectedSpaceIdsRef: React.MutableRefObject<string[] | null>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): {
  handleNodeDragStart: (
    event: React.MouseEvent,
    node: Node<TerminalNodeData>,
    nodes: Node<TerminalNodeData>[],
  ) => void
  handleSelectionDragStart: (event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => void
  handleNodeDragStop: (
    event: React.MouseEvent,
    node: Node<TerminalNodeData>,
    nodes: Node<TerminalNodeData>[],
  ) => void
  handleSelectionDragStop: (event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => void
} {
  const { t } = useTranslation()
  const dragStartNodeIdsRef = useRef<string[] | null>(null)
  const dragStartNodePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)

  const applyOwnershipForDrop = useCallback(
    ({
      draggedNodeIds,
      draggedNodePositionById,
      dragStartNodePositionById,
      dropFlowPoint,
    }: {
      draggedNodeIds: string[]
      draggedNodePositionById: Map<string, { x: number; y: number }>
      dragStartNodePositionById: Map<string, { x: number; y: number }>
      dropFlowPoint: { x: number; y: number }
    }) => {
      if (draggedNodeIds.length === 0) {
        return
      }

      const nodeIds = draggedNodeIds
      const draggedNodesForTarget = buildDraggedNodesForTarget({
        nodeIds,
        draggedNodePositionById,
        getNode: nodeId => reactFlow.getNode(nodeId) ?? undefined,
      })

      const draggedDropRect = computeBoundingRect(draggedNodesForTarget)
      const targetSpace = resolveSpaceAtPoint(
        spacesRef.current,
        draggedDropRect
          ? {
              x: draggedDropRect.x + draggedDropRect.width / 2,
              y: draggedDropRect.y + draggedDropRect.height / 2,
            }
          : dropFlowPoint,
      )
      const targetSpaceId = targetSpace?.id ?? null
      const nodeIdSet = new Set(nodeIds)

      const { nextSpaces, hasSpaceChange } = reassignNodesAcrossSpaces({
        spaces: spacesRef.current,
        nodeIds,
        targetSpaceId,
      })

      if (hasSpaceChange) {
        const validationError = validateSpaceTransfer(
          nodeIds,
          reactFlow.getNodes(),
          targetSpace,
          workspacePath,
          t,
        )

        if (validationError) {
          setNodes(
            prevNodes => {
              let hasChanged = false

              const revertedNodes = prevNodes.map(node => {
                if (!nodeIdSet.has(node.id)) {
                  return node
                }

                const startPosition = dragStartNodePositionById.get(node.id)
                if (!startPosition) {
                  return node
                }

                if (node.position.x === startPosition.x && node.position.y === startPosition.y) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  position: startPosition,
                }
              })

              return hasChanged ? revertedNodes : prevNodes
            },
            { syncLayout: false },
          )

          restoreSelectionAfterDrop({ selectedNodeIds: nodeIds, setNodes })
          onShowMessage?.(validationError, 'warning')
          return
        }
      }

      let shouldEnsureSpaceFitsOwnedNodes =
        hasSpaceChange && Boolean(targetSpaceId && targetSpace?.rect)
      let resolvedRects: Array<{ id: string; rect: WorkspaceSpaceRect }> | null = null

      setNodes(prevNodes => {
        const draggedNodes = prevNodes.filter(node => nodeIdSet.has(node.id))
        if (draggedNodes.length === 0) {
          return prevNodes
        }

        const basePositionByNodeId = new Map<string, { x: number; y: number }>()
        for (const node of draggedNodes) {
          const fromDrag = draggedNodePositionById.get(node.id)
          basePositionByNodeId.set(node.id, fromDrag ?? node.position)
        }

        const draggedForCalc = draggedNodes.map(node => {
          const base = basePositionByNodeId.get(node.id)
          if (!base) {
            return node
          }

          if (node.position.x === base.x && node.position.y === base.y) {
            return node
          }

          return {
            ...node,
            position: base,
          }
        })

        const dropRect = computeBoundingRect(draggedForCalc)
        const dropSpaceRect = targetSpace?.rect ?? null

        const { dx: baseDx, dy: baseDy } =
          dropRect && dropSpaceRect
            ? resolveDeltaToKeepRectInsideRect(dropRect, dropSpaceRect, 0)
            : dropRect
              ? resolveDeltaToKeepRectOutsideRects(
                  dropRect,
                  spacesRef.current
                    .map(space => space.rect)
                    .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect))
                    .map(rect => inflateRect(rect, 0)),
                )
              : { dx: 0, dy: 0 }

        const others = prevNodes.filter(node => !nodeIdSet.has(node.id))

        const forbiddenSpaceRects = dropSpaceRect
          ? []
          : spacesRef.current
              .map(space => space.rect)
              .filter((rect): rect is WorkspaceSpaceRect => Boolean(rect))

        const {
          dx: extraDx,
          dy: extraDy,
          canPlace,
        } = resolveNearestNonOverlappingDropOffset({
          draggedNodes: draggedForCalc,
          otherNodes: others,
          baseDx,
          baseDy,
          targetSpaceRect: dropSpaceRect,
          forbiddenSpaceRects,
        })

        if (canPlace) {
          const dx = baseDx + extraDx
          const dy = baseDy + extraDy

          const nextNodes = prevNodes.map(node => {
            if (!nodeIdSet.has(node.id)) {
              return node
            }

            const base = basePositionByNodeId.get(node.id) ?? node.position
            const nextPosition = {
              x: base.x + dx,
              y: base.y + dy,
            }

            if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
              return node
            }

            return {
              ...node,
              position: nextPosition,
            }
          })

          resolvedRects = nextNodes.map(node => ({
            id: node.id,
            rect: {
              x: node.position.x,
              y: node.position.y,
              width: node.data.width,
              height: node.data.height,
            },
          }))

          return nextNodes
        }

        shouldEnsureSpaceFitsOwnedNodes = hasSpaceChange && Boolean(dropSpaceRect && targetSpaceId)

        const clampedNodes = prevNodes.map(node => {
          if (!nodeIdSet.has(node.id)) {
            return node
          }

          const base = basePositionByNodeId.get(node.id) ?? node.position
          const nextPosition = {
            x: base.x + baseDx,
            y: base.y + baseDy,
          }

          if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
            return node
          }

          return {
            ...node,
            position: nextPosition,
          }
        })

        const nextPositionByNodeId = computePushedPositionsToClearPinnedNodes({
          nodes: clampedNodes,
          pinnedNodeIds: nodeIds,
        })

        const nextNodes = clampedNodes.map(node => {
          const nextPosition = nextPositionByNodeId.get(node.id)
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

        resolvedRects = nextNodes.map(node => ({
          id: node.id,
          rect: {
            x: node.position.x,
            y: node.position.y,
            width: node.data.width,
            height: node.data.height,
          },
        }))

        return nextNodes
      })

      if (shouldEnsureSpaceFitsOwnedNodes && targetSpaceId && resolvedRects) {
        const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
          targetSpaceId,
          spaces: nextSpaces,
          nodeRects: resolvedRects,
          gap: 24,
        })

        if (nodePositionById.size > 0) {
          setNodes(
            prevNodes => {
              let hasChanged = false
              const nextNodes = prevNodes.map(node => {
                const nextPosition = nodePositionById.get(node.id)
                if (!nextPosition) {
                  return node
                }

                if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
                  return node
                }

                hasChanged = true
                return {
                  ...node,
                  position: nextPosition,
                }
              })

              return hasChanged ? nextNodes : prevNodes
            },
            { syncLayout: false },
          )
        }

        onSpacesChange(pushedSpaces)
      } else if (hasSpaceChange) {
        onSpacesChange(nextSpaces)
      }

      applyDirectoryExpectationForDrop({ nodeIds, targetSpace, workspacePath, setNodes })
      restoreSelectionAfterDrop({ selectedNodeIds: nodeIds, setNodes })
      if (hasSpaceChange || nodeIds.length > 0) {
        onRequestPersistFlush?.()
      }
    },
    [
      onRequestPersistFlush,
      onShowMessage,
      onSpacesChange,
      reactFlow,
      setNodes,
      t,
      workspacePath,
      spacesRef,
    ],
  )

  const captureDragStartNodeIds = useCallback(
    (nodes: Node<TerminalNodeData>[]) => {
      dragStartNodeIdsRef.current = nodes.map(node => node.id)
      dragStartNodePositionByIdRef.current = new Map(
        nodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
      )
      dragSelectedSpaceIdsRef.current = [...selectedSpaceIdsRef.current]
    },
    [dragSelectedSpaceIdsRef, selectedSpaceIdsRef],
  )

  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: Node<TerminalNodeData>, nodes: Node<TerminalNodeData>[]) => {
      const draggedNodes = nodes.length > 0 ? nodes : [node]
      captureDragStartNodeIds(draggedNodes)
    },
    [captureDragStartNodeIds],
  )

  const handleSelectionDragStart = useCallback(
    (_event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => {
      captureDragStartNodeIds(nodes)
    },
    [captureDragStartNodeIds],
  )

  const handleNodeDragStop = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>, nodes: Node<TerminalNodeData>[]) => {
      if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') {
        return
      }

      const dropPoint = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const recorded = dragStartNodeIdsRef.current
      dragStartNodeIdsRef.current = null
      const dragStartNodePositionById = dragStartNodePositionByIdRef.current ?? new Map()
      dragStartNodePositionByIdRef.current = null

      const fallbackNodes = nodes.length > 0 ? nodes : [node]
      const draggedNodeIds =
        recorded && recorded.includes(node.id) && recorded.length > 0
          ? recorded
          : fallbackNodes.map(item => item.id)

      const draggedNodePositionById = collectDraggedNodePositions({
        draggedNodeIds,
        fallbackNodes,
        getNode: nodeId => reactFlow.getNode(nodeId) ?? undefined,
      })

      applyOwnershipForDrop({
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dropFlowPoint: dropPoint,
      })
      dragSelectedSpaceIdsRef.current = null
    },
    [applyOwnershipForDrop, dragSelectedSpaceIdsRef, reactFlow],
  )

  const handleSelectionDragStop = useCallback(
    (event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => {
      if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') {
        return
      }

      const dropPoint = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const recorded = dragStartNodeIdsRef.current
      dragStartNodeIdsRef.current = null
      const dragStartNodePositionById = dragStartNodePositionByIdRef.current ?? new Map()
      dragStartNodePositionByIdRef.current = null

      const fallbackNodes = nodes
      const draggedNodeIds =
        recorded && recorded.length > 0
          ? recorded
          : fallbackNodes.length > 0
            ? fallbackNodes.map(item => item.id)
            : []

      const draggedNodePositionById = collectDraggedNodePositions({
        draggedNodeIds,
        fallbackNodes,
        getNode: nodeId => reactFlow.getNode(nodeId) ?? undefined,
      })

      applyOwnershipForDrop({
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dropFlowPoint: dropPoint,
      })
      dragSelectedSpaceIdsRef.current = null
    },
    [applyOwnershipForDrop, dragSelectedSpaceIdsRef, reactFlow],
  )

  return {
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
  }
}
