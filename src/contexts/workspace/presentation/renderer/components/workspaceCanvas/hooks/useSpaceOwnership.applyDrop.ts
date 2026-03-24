import { useCallback, type MutableRefObject } from 'react'
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
} from './useSpaceOwnership.drop.helpers'
import { projectWorkspaceNodeDropLayout } from './useSpaceOwnership.projectDropLayout'
import { buildOwningSpaceIdByNodeId } from './workspaceLayoutPolicy'

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

      const hasSpaceRectOverride =
        Boolean(spaceRectOverrideById) && (spaceRectOverrideById?.size ?? 0) > 0
      const spacesWithRectOverride = hasSpaceRectOverride
        ? applySpaceRectOverrides({
            spaces: spacesRef.current,
            rectOverrideById: spaceRectOverrideById!,
          })
        : spacesRef.current

      const nodeIds = draggedNodeIds
      const nodeIdSet = new Set(nodeIds)
      const draggedNodesForTarget = buildDraggedNodesForTarget({
        nodeIds,
        draggedNodePositionById,
        getNode: nodeId => reactFlow.getNode(nodeId) ?? undefined,
      })

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
      const anchorNodeId = nodeIds[0] ?? null
      const dragStart = anchorNodeId ? (dragStartNodePositionById.get(anchorNodeId) ?? null) : null
      const dragEnd = anchorNodeId ? (draggedNodePositionById.get(anchorNodeId) ?? null) : null
      const dragDx = dragStart && dragEnd ? dragEnd.x - dragStart.x : 0
      const dragDy = dragStart && dragEnd ? dragEnd.y - dragStart.y : 0

      const { hasSpaceChange: hasOwnershipChange } = reassignNodesAcrossSpaces({
        spaces: spacesRef.current,
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

      let projectedNextSpaces: WorkspaceSpaceState[] | null = null
      let hasProjectedSpaceChange = false

      setNodes(prevNodes => {
        const draggedNodes = prevNodes.filter(node => nodeIdSet.has(node.id))
        if (draggedNodes.length === 0) {
          return prevNodes
        }

        const projectedSpaces = hasSpaceRectOverride ? spacesWithRectOverride : spacesRef.current
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

        const projected = projectWorkspaceNodeDropLayout({
          nodes: baselineNodes,
          spaces: projectedSpaces,
          draggedNodeIds: nodeIds,
          draggedNodePositionById,
          dragDx,
          dragDy,
          dropFlowPoint,
        })

        projectedNextSpaces = projected.nextSpaces
        hasProjectedSpaceChange = projected.hasSpaceChange

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

        return nextNodes
      })

      if (
        projectedNextSpaces &&
        (shouldCommitSpaceRectOverride || hasProjectedSpaceChange || hasOwnershipChange)
      ) {
        onSpacesChange(projectedNextSpaces)
      }

      applyDirectoryExpectationForDrop({ nodeIds, targetSpace, workspacePath, setNodes })
      restoreSelectionAfterDrop({ selectedNodeIds: nodeIds, setNodes })
      if (hasOwnershipChange || nodeIds.length > 0) {
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
