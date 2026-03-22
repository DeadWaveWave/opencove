import { useCallback, type MutableRefObject } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { sanitizeSpaces, validateSpaceTransfer } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
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

interface ApplyOwnershipForDropInput {
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragStartNodePositionById: Map<string, { x: number; y: number }>
  dropFlowPoint: { x: number; y: number }
}

export function useWorkspaceCanvasApplyOwnershipForDrop({
  workspacePath,
  reactFlow,
  spacesRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
  resolveSpaceAtPoint,
  t,
}: {
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  resolveSpaceAtPoint: (point: { x: number; y: number }) => WorkspaceSpaceState | null
  t: TranslateFn
}): (input: ApplyOwnershipForDropInput, options?: { allowDirectoryMismatch?: boolean }) => void {
  return useCallback(
    (
      {
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dropFlowPoint,
      }: ApplyOwnershipForDropInput,
      options?: { allowDirectoryMismatch?: boolean },
    ) => {
      if (draggedNodeIds.length === 0) {
        return
      }

      const nodeIds = draggedNodeIds
      const draggedNodesForTarget = nodeIds
        .map(nodeId => {
          const node = reactFlow.getNode(nodeId)
          if (!node) {
            return null
          }

          const draggedPosition = draggedNodePositionById.get(nodeId)
          if (!draggedPosition) {
            return node
          }

          if (node.position.x === draggedPosition.x && node.position.y === draggedPosition.y) {
            return node
          }

          return {
            ...node,
            position: draggedPosition,
          }
        })
        .filter((node): node is Node<TerminalNodeData> => Boolean(node))

      const draggedDropRect = computeBoundingRect(draggedNodesForTarget)
      const dropTargetPoint =
        draggedDropRect && nodeIds.length > 1
          ? {
              x: draggedDropRect.x + draggedDropRect.width / 2,
              y: draggedDropRect.y + draggedDropRect.height / 2,
            }
          : dropFlowPoint
      const targetSpace = resolveSpaceAtPoint(dropTargetPoint)
      const targetSpaceId = targetSpace?.id ?? null
      const nodeIdSet = new Set(nodeIds)

      const nextSpaces = sanitizeSpaces(
        spacesRef.current.map(space => {
          const filtered = space.nodeIds.filter(nodeId => !nodeIdSet.has(nodeId))
          if (!targetSpaceId || space.id !== targetSpaceId) {
            return { ...space, nodeIds: filtered }
          }

          const incomingNodeIds = nodeIds.filter(nodeId => !space.nodeIds.includes(nodeId))
          if (incomingNodeIds.length === 0) {
            return space
          }

          return { ...space, nodeIds: [...space.nodeIds, ...incomingNodeIds] }
        }),
      )

      const hasSpaceChange =
        nextSpaces.length !== spacesRef.current.length ||
        nextSpaces.some((space, index) => {
          const prevSpace = spacesRef.current[index]
          if (!prevSpace) {
            return true
          }

          if (space.id !== prevSpace.id) {
            return true
          }

          if (space.nodeIds.length !== prevSpace.nodeIds.length) {
            return true
          }

          for (let i = 0; i < space.nodeIds.length; i += 1) {
            if (space.nodeIds[i] !== prevSpace.nodeIds[i]) {
              return true
            }
          }

          return false
        })

      if (hasSpaceChange) {
        const validationError = validateSpaceTransfer(
          nodeIds,
          reactFlow.getNodes(),
          targetSpace,
          workspacePath,
          t,
          { allowDirectoryMismatch: options?.allowDirectoryMismatch === true },
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
          gap: 0,
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
      resolveSpaceAtPoint,
      setNodes,
      spacesRef,
      t,
      workspacePath,
    ],
  )
}
