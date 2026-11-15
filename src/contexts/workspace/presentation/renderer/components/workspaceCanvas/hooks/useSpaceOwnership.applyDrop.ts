import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { validateSpaceTransfer } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
import {
  applyDirectoryExpectationForDrop,
  computeBoundingRect,
  restoreSelectionAfterDrop,
  type SetNodes,
} from './useSpaceOwnership.helpers'
import {
  buildDraggedNodesForTarget,
  reassignNodesAcrossSpaces,
  resolveSpaceAtPoint as resolveSpaceAtPointFromHelpers,
} from './useSpaceOwnership.drop.helpers'
import {
  projectCanvasInteractionDrop,
  readCanvasInteractionState,
} from './useNodeDragSession.collapse'
import {
  projectCanvasInteractionLayout,
  getPresentedNodeSize,
} from '../../../utils/canvasInteractionLayout'
import { buildOwningSpaceIdByNodeId } from './workspaceLayoutPolicy'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { useReadCanvasDocument } from '../../../store/canvasStoreContext'

function rectEquals(a: WorkspaceSpaceRect | null, b: WorkspaceSpaceRect | null): boolean {
  if (a === b) {
    return true
  }

  if (!a || !b) {
    return false
  }

  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function applySpaceRectOverrides({
  spaces,
  rectOverrideById,
}: {
  spaces: WorkspaceSpaceState[]
  rectOverrideById: ReadonlyMap<string, WorkspaceSpaceRect>
}): WorkspaceSpaceState[] {
  return spaces.map(space => {
    const override = rectOverrideById.get(space.id) ?? null
    if (!override) {
      return space
    }

    if (rectEquals(space.rect ?? null, override)) {
      return space
    }

    return { ...space, rect: { ...override } }
  })
}

interface ApplyOwnershipForDropInput {
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragStartNodePositionById: Map<string, { x: number; y: number }>
  dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
  dragStartSpaceRectById?: Map<string, WorkspaceSpaceRect>
  dropFlowPoint: { x: number; y: number }
  spaceRectOverrideById?: ReadonlyMap<string, WorkspaceSpaceRect> | null
}

export function useWorkspaceCanvasApplyOwnershipForDrop({
  workspaceId,
  workspacePath,
  reactFlow,
  setNodes,
  updateCanvasDocument,
  onShowMessage,
  resolveSpaceAtPoint,
  t,
}: {
  workspaceId?: string
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  setNodes: SetNodes
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  onShowMessage?: ShowWorkspaceCanvasMessage
  resolveSpaceAtPoint: (point: { x: number; y: number }) => WorkspaceSpaceState | null
  t: TranslateFn
}): (input: ApplyOwnershipForDropInput, options?: { allowDirectoryMismatch?: boolean }) => void {
  const readDocument = useReadCanvasDocument()
  return useCallback(
    (
      {
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dragStartSpaceRectById,
        dropFlowPoint,
        spaceRectOverrideById,
      }: ApplyOwnershipForDropInput,
      options?: { allowDirectoryMismatch?: boolean },
    ) => {
      if (draggedNodeIds.length === 0) {
        return
      }

      // The decisions that can stop the drop before it writes (the target Space, the ownership
      // change and its validation) come from one read of the committed Spaces. What the drop
      // writes is planned inside the recipe from the document the write is computed from.
      const { spaces: committedSpaces } = readDocument()
      const hasSpaceRectOverride =
        Boolean(spaceRectOverrideById) && (spaceRectOverrideById?.size ?? 0) > 0
      const spacesWithRectOverride = hasSpaceRectOverride
        ? applySpaceRectOverrides({
            spaces: committedSpaces,
            rectOverrideById: spaceRectOverrideById!,
          })
        : committedSpaces

      const nodeIds = draggedNodeIds
      const nodeIdSet = new Set(nodeIds)
      const draggedNodesForTarget = buildDraggedNodesForTarget({
        nodeIds,
        draggedNodePositionById,
        getNode: nodeId => {
          const node = reactFlow.getNode(nodeId)
          return node
            ? { ...node, data: { ...node.data, ...getPresentedNodeSize(node.data) } }
            : undefined
        },
      })

      const draggedDropRect = computeBoundingRect(draggedNodesForTarget)
      const dropTargetPoint =
        draggedDropRect && nodeIds.length > 1
          ? {
              x: draggedDropRect.x + draggedDropRect.width / 2,
              y: draggedDropRect.y + draggedDropRect.height / 2,
            }
          : dropFlowPoint
      const targetSpace = hasSpaceRectOverride
        ? resolveSpaceAtPointFromHelpers(
            projectCanvasInteractionLayout(
              reactFlow.getNodes(),
              spacesWithRectOverride,
              readCanvasInteractionState(workspaceId),
            ).spaces,
            dropTargetPoint,
          )
        : resolveSpaceAtPoint(dropTargetPoint)
      const targetSpaceId = targetSpace?.id ?? null
      const anchorNodeId = nodeIds[0] ?? null
      const dragStart = anchorNodeId ? (dragStartNodePositionById.get(anchorNodeId) ?? null) : null
      const dragEnd = anchorNodeId ? (draggedNodePositionById.get(anchorNodeId) ?? null) : null
      const dragDx = dragStart && dragEnd ? dragEnd.x - dragStart.x : 0
      const dragDy = dragStart && dragEnd ? dragEnd.y - dragStart.y : 0

      const { hasSpaceChange: hasOwnershipChange } = reassignNodesAcrossSpaces({
        spaces: committedSpaces,
        nodeIds,
        targetSpaceId,
      })

      if (hasOwnershipChange) {
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
                const startPosition =
                  dragStartAllNodePositionById?.get(node.id) ??
                  (nodeIdSet.has(node.id) ? dragStartNodePositionById.get(node.id) : undefined)
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

      const shouldCommitSpaceRectOverride = hasSpaceRectOverride && targetSpaceId !== null

      // The nodes and the Spaces of the drop are one store update. The projection, and the Spaces
      // it is projected from, come from the recipe's own arguments.
      updateCanvasDocument(({ nodes: prevNodes, spaces: documentSpaces }) => {
        const draggedNodes = prevNodes.filter(node => nodeIdSet.has(node.id))
        if (draggedNodes.length === 0) {
          return { nodes: prevNodes, spaces: documentSpaces }
        }

        const projectedSpaces = hasSpaceRectOverride
          ? applySpaceRectOverrides({
              spaces: documentSpaces,
              rectOverrideById: spaceRectOverrideById!,
            })
          : documentSpaces
        const currentSpaceRectById = new Map(
          projectedSpaces
            .filter(space => Boolean(space.rect))
            .map(space => [space.id, space.rect!] as const),
        )
        const owningSpaceIdByNodeId = buildOwningSpaceIdByNodeId(projectedSpaces)
        const movedSpaceDeltaById = new Map<string, { dx: number; dy: number }>()

        if (dragStartSpaceRectById) {
          for (const [spaceId, baselineRect] of dragStartSpaceRectById.entries()) {
            const currentRect = currentSpaceRectById.get(spaceId) ?? null
            if (!currentRect) {
              continue
            }

            const dx = currentRect.x - baselineRect.x
            const dy = currentRect.y - baselineRect.y
            if (dx !== 0 || dy !== 0) {
              movedSpaceDeltaById.set(spaceId, { dx, dy })
            }
          }
        }

        const baselineNodes = dragStartAllNodePositionById
          ? prevNodes.map(node => {
              const baseline = dragStartAllNodePositionById.get(node.id)
              if (!baseline) {
                return node
              }

              const owningSpaceId = !nodeIdSet.has(node.id)
                ? (owningSpaceIdByNodeId.get(node.id) ?? null)
                : null
              const owningSpaceDelta =
                owningSpaceId !== null ? (movedSpaceDeltaById.get(owningSpaceId) ?? null) : null
              const resolvedBaseline = owningSpaceDelta
                ? { x: baseline.x + owningSpaceDelta.dx, y: baseline.y + owningSpaceDelta.dy }
                : baseline

              if (
                node.position.x === resolvedBaseline.x &&
                node.position.y === resolvedBaseline.y
              ) {
                return node
              }

              return {
                ...node,
                position: resolvedBaseline,
              }
            })
          : prevNodes

        const projected = projectCanvasInteractionDrop(
          {
            nodes: baselineNodes,
            spaces: projectedSpaces,
            draggedNodeIds: nodeIds,
            draggedNodePositionById,
            dragDx,
            dragDy,
            dropFlowPoint,
          },
          workspaceId,
        )

        const nextNodes = prevNodes.map(node => {
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

        const shouldWriteSpaces =
          shouldCommitSpaceRectOverride || projected.hasSpaceChange || hasOwnershipChange

        return {
          nodes: nextNodes,
          spaces: shouldWriteSpaces ? projected.nextSpaces : documentSpaces,
        }
      })

      // The flush rides on the directory write, the last synchronous write of the drop: it also
      // runs when that write changes nothing, and never before it.
      applyDirectoryExpectationForDrop({
        nodeIds,
        targetSpace,
        workspacePath,
        setNodes,
        flush: true,
      })
      restoreSelectionAfterDrop({ selectedNodeIds: nodeIds, setNodes })
    },
    [
      onShowMessage,
      readDocument,
      reactFlow,
      resolveSpaceAtPoint,
      setNodes,
      t,
      updateCanvasDocument,
      workspacePath,
      workspaceId,
    ],
  )
}
