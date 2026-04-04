import { useCallback } from 'react'
import { applyNodeChanges } from '@xyflow/react'
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react'
import type { TerminalNodeData } from '../../../types'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { TERMINAL_LAYOUT_SYNC_EVENT } from '../../terminalNode/constants'
import { type UseApplyNodeChangesParams } from './useApplyNodeChanges.helpers'

export function useWorkspaceCanvasApplyNodeChanges({
  nodesRef,
  onNodesChange,
  clearAgentLaunchToken,
  normalizePosition,
  applyPendingScrollbacks,
  isNodeDraggingRef,
  exclusiveNodeDragAnchorIdRef,
  nodeDragSession,
}: UseApplyNodeChangesParams): (changes: NodeChange<Node<TerminalNodeData>>[]) => void {
  return useCallback(
    (changes: NodeChange<Node<TerminalNodeData>>[]) => {
      const wasDragging = isNodeDraggingRef.current
      const exclusiveAnchorId = exclusiveNodeDragAnchorIdRef?.current ?? null
      const filteredChanges = changes
        .filter(
          change =>
            change.type !== 'add' && change.type !== 'replace' && change.type !== 'dimensions',
        )
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

      if (!wasDragging && isDraggingThisFrame) {
        nodeDragSession.beginNodeDragSession(currentNodes)
      }

      if (wasDragging && !isDraggingThisFrame) {
        nextNodes = nodeDragSession.applyPendingReleaseProjection(nextNodes)
        nodeDragSession.endNodeDragSession()
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

        const dropFlowPoint =
          draggedNodeIds.length === 1 &&
          nodeDragSession.nodeDragPointerAnchorRef.current?.nodeId === draggedNodeIds[0] &&
          desiredDraggedPositionById.get(draggedNodeIds[0])
            ? (() => {
                const anchor = nodeDragSession.nodeDragPointerAnchorRef.current!
                const desired = desiredDraggedPositionById.get(draggedNodeIds[0])!
                return { x: desired.x + anchor.offset.x, y: desired.y + anchor.offset.y }
              })()
            : null

        const prevAnchor = anchorChange
          ? (currentNodes.find(node => node.id === anchorChange.id) ?? null)
          : null
        const anchorIsSelected = prevAnchor?.selected === true
        nextNodes = nodeDragSession.projectNodeDrag({
          currentNodes: nextNodes,
          draggedNodeIds,
          desiredDraggedPositionById,
          dropFlowPoint,
          anchorNodeId,
          anchorIsSelected,
        }).nextNodes
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
      nodeDragSession,
      nodesRef,
      normalizePosition,
      onNodesChange,
    ],
  )
}
