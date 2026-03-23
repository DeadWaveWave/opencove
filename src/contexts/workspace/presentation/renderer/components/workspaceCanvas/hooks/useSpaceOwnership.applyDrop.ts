import { useCallback, type MutableRefObject } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { pushAwayLayout, type LayoutDirection } from '../../../utils/spaceLayout'
import { sanitizeSpaces, validateSpaceTransfer } from '../helpers'
import type { ShowWorkspaceCanvasMessage } from '../types'
import {
  applyDirectoryExpectationForDrop,
  computeBoundingRect,
  restoreSelectionAfterDrop,
  type SetNodes,
} from './useSpaceOwnership.helpers'
import { projectWorkspaceNodeDragLayout } from './useSpaceOwnership.projectLayout'

interface ApplyOwnershipForDropInput {
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragStartNodePositionById: Map<string, { x: number; y: number }>
  dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
  dropFlowPoint: { x: number; y: number }
}

function buildDragDirectionPreference(dx: number, dy: number): LayoutDirection[] {
  const ordered: LayoutDirection[] = []
  const xDirection = dx >= 0 ? ('x+' as const) : ('x-' as const)
  const yDirection = dy >= 0 ? ('y+' as const) : ('y-' as const)

  if (Math.abs(dx) >= Math.abs(dy)) {
    ordered.push(xDirection, yDirection)
  } else {
    ordered.push(yDirection, xDirection)
  }

  if (!ordered.includes('x+')) {
    ordered.push('x+')
  }
  if (!ordered.includes('x-')) {
    ordered.push('x-')
  }
  if (!ordered.includes('y+')) {
    ordered.push('y+')
  }
  if (!ordered.includes('y-')) {
    ordered.push('y-')
  }

  return ordered
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
      const anchorNodeId = nodeIds[0] ?? null
      const dragStart = anchorNodeId ? (dragStartNodePositionById.get(anchorNodeId) ?? null) : null
      const dragEnd = anchorNodeId ? (draggedNodePositionById.get(anchorNodeId) ?? null) : null
      const dragDx = dragStart && dragEnd ? dragEnd.x - dragStart.x : 0
      const dragDy = dragStart && dragEnd ? dragEnd.y - dragStart.y : 0
      const dragDirections = buildDragDirectionPreference(dragDx, dragDy)

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

      let shouldEnsureSpaceFitsOwnedNodes = Boolean(targetSpaceId && targetSpace?.rect)
      let hasResolvedRects = false
      let resolvedRects: Array<{ id: string; rect: WorkspaceSpaceRect }> = []

      setNodes(prevNodes => {
        const draggedNodes = prevNodes.filter(node => nodeIdSet.has(node.id))
        if (draggedNodes.length === 0) {
          return prevNodes
        }

        const projected = projectWorkspaceNodeDragLayout({
          nodes: prevNodes,
          spaces: spacesRef.current,
          draggedNodeIds: nodeIds,
          draggedNodePositionById,
          dragDx,
          dragDy,
        })

        if (!projected) {
          return prevNodes
        }

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

        resolvedRects = nextNodes.map(node => ({
          id: node.id,
          rect: {
            x: node.position.x,
            y: node.position.y,
            width: node.data.width,
            height: node.data.height,
          },
        }))
        hasResolvedRects = true

        return nextNodes
      })

      if (targetSpaceId && hasResolvedRects) {
        const targetSpaceNodeIds =
          nextSpaces.find(space => space.id === targetSpaceId)?.nodeIds ?? []

        if (targetSpaceNodeIds.length > 1) {
          const rectByNodeId = new Map(resolvedRects.map(item => [item.id, item.rect]))
          const reflowItems = targetSpaceNodeIds
            .map(nodeId => {
              const rect = rectByNodeId.get(nodeId)
              if (!rect) {
                return null
              }

              return {
                id: nodeId,
                kind: 'node' as const,
                groupId: nodeId,
                rect: { ...rect },
              }
            })
            .filter(
              (
                item,
              ): item is {
                id: string
                kind: 'node'
                groupId: string
                rect: WorkspaceSpaceRect
              } => Boolean(item),
            )

          if (reflowItems.length > 1) {
            const pushed = pushAwayLayout({
              items: reflowItems,
              pinnedGroupIds: nodeIds,
              sourceGroupIds: nodeIds,
              directions: dragDirections,
              gap: 0,
            })

            const reflowPositionByNodeId = new Map(
              pushed.map(item => [item.id, { x: item.rect.x, y: item.rect.y }]),
            )

            if (reflowPositionByNodeId.size > 0) {
              setNodes(
                prevNodes => {
                  let hasChanged = false

                  const nextNodes = prevNodes.map(node => {
                    const nextPosition = reflowPositionByNodeId.get(node.id)
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

              resolvedRects = resolvedRects.map(item => {
                const nextPosition = reflowPositionByNodeId.get(item.id)
                if (!nextPosition) {
                  return item
                }

                return {
                  id: item.id,
                  rect: {
                    ...item.rect,
                    x: nextPosition.x,
                    y: nextPosition.y,
                  },
                }
              })
            }
          }
        }
      }

      if (shouldEnsureSpaceFitsOwnedNodes && targetSpaceId && hasResolvedRects) {
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
