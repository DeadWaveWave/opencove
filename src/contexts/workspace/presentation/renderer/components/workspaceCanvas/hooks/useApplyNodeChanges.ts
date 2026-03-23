import { useCallback, type MutableRefObject } from 'react'
import {
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodePositionChange,
} from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { projectWorkspaceNodeDragLayout } from './useSpaceOwnership.projectLayout'

interface UseApplyNodeChangesParams {
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  onNodesChange: (nodes: Node<TerminalNodeData>[]) => void
  clearAgentLaunchToken: (nodeId: string) => void
  normalizePosition: (
    nodeId: string,
    desired: { x: number; y: number },
    size: { width: number; height: number },
  ) => { x: number; y: number }
  applyPendingScrollbacks: (targetNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[]
  isNodeDraggingRef: MutableRefObject<boolean>
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  selectedSpaceIdsRef: MutableRefObject<string[]>
  dragSelectedSpaceIdsRef?: MutableRefObject<string[] | null>
  exclusiveNodeDragAnchorIdRef?: MutableRefObject<string | null>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}

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
  exclusiveNodeDragAnchorIdRef,
  onSpacesChange,
  onRequestPersistFlush,
}: UseApplyNodeChangesParams): (changes: NodeChange<Node<TerminalNodeData>>[]) => void {
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

      const settledPositionChanges: NodePositionChange[] = filteredChanges.filter(
        (change): change is NodePositionChange =>
          change.type === 'position' &&
          change.dragging === false &&
          change.position !== undefined &&
          !removedIds.has(change.id),
      )

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

      if (shouldSyncSelectedSpaces) {
        const nextAnchor = nextNodes.find(node => node.id === anchorChange.id) ?? null

        if (prevAnchor && nextAnchor) {
          const dx = nextAnchor.position.x - prevAnchor.position.x
          const dy = nextAnchor.position.y - prevAnchor.position.y

          if (dx !== 0 || dy !== 0) {
            const selectedSpaceIdSet = new Set(activeSelectedSpaceIds)
            const previousSpaces = spacesRef.current
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

            const draggedNodeIds = new Set(positionChanges.map(change => change.id))
            const ownedNodeIdsToShift = new Set<string>()

            for (const space of previousSpaces) {
              if (!movedSpaceIds.has(space.id)) {
                continue
              }

              for (const nodeId of space.nodeIds) {
                if (draggedNodeIds.has(nodeId)) {
                  continue
                }

                ownedNodeIdsToShift.add(nodeId)
              }
            }

            if (ownedNodeIdsToShift.size > 0) {
              nextNodes = nextNodes.map(node => {
                if (!ownedNodeIdsToShift.has(node.id)) {
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

        const draggedNodePositionById = new Map<string, { x: number; y: number }>()
        for (const nodeId of draggedNodeIds) {
          const node = nextNodes.find(candidate => candidate.id === nodeId)
          if (!node) {
            continue
          }

          draggedNodePositionById.set(nodeId, {
            x: node.position.x,
            y: node.position.y,
          })
        }

        const anchorNodeId =
          positionChanges.find(change => change.dragging !== false && change.position !== undefined)
            ?.id ?? draggedNodeIds[0]
        const previousDragAnchor = anchorNodeId
          ? (currentNodes.find(node => node.id === anchorNodeId) ?? null)
          : null
        const nextDragAnchor = anchorNodeId
          ? (nextNodes.find(node => node.id === anchorNodeId) ?? null)
          : null
        const dragDx =
          previousDragAnchor && nextDragAnchor
            ? nextDragAnchor.position.x - previousDragAnchor.position.x
            : 0
        const dragDy =
          previousDragAnchor && nextDragAnchor
            ? nextDragAnchor.position.y - previousDragAnchor.position.y
            : 0

        const projected = projectWorkspaceNodeDragLayout({
          nodes: nextNodes,
          spaces: spacesRef.current,
          draggedNodeIds,
          draggedNodePositionById,
          dragDx,
          dragDy,
        })

        if (projected) {
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
      onNodesChange,
      onRequestPersistFlush,
      onSpacesChange,
      dragSelectedSpaceIdsRef,
      selectedSpaceIdsRef,
      spacesRef,
    ],
  )
}
