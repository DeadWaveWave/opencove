import { useCallback, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import { resolveWorkspaceSnap } from '../../../utils/workspaceSnap'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import type { ShowWorkspaceCanvasMessage } from '../types'
import {
  collectDraggedNodePositions,
  resolveSpaceAtPoint as resolveSpaceAtPointFromHelpers,
} from './useSpaceOwnership.drop.helpers'
import type { SetNodes } from './useSpaceOwnership.helpers'
import { useWorkspaceCanvasApplyOwnershipForDrop } from './useSpaceOwnership.applyDrop'

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

  const resolveDropTargetSpaceAtPoint = useCallback(
    (point: { x: number; y: number }): WorkspaceSpaceState | null =>
      resolveSpaceAtPointFromHelpers(spacesRef.current, point),
    [spacesRef],
  )

  const applyOwnershipForDrop = useWorkspaceCanvasApplyOwnershipForDrop({
    workspacePath,
    reactFlow,
    spacesRef,
    setNodes,
    onSpacesChange,
    onRequestPersistFlush,
    onShowMessage,
    resolveSpaceAtPoint: resolveDropTargetSpaceAtPoint,
    t,
  })

  const resolveSnappedDraggedNodePositions = useCallback(
    (
      draggedNodeIds: string[],
      draggedNodePositionById: Map<string, { x: number; y: number }>,
      fallbackNodes: Node<TerminalNodeData>[],
    ): Map<string, { x: number; y: number }> => {
      if (draggedNodeIds.length === 0) {
        return draggedNodePositionById
      }

      const movingNodeIds = new Set(draggedNodeIds)
      const currentNodes = reactFlow.getNodes().map(node => {
        const draggedPosition = draggedNodePositionById.get(node.id)
        if (!draggedPosition) {
          return node
        }

        return {
          ...node,
          position: draggedPosition,
        }
      })

      const movingNodes = currentNodes.filter(node => movingNodeIds.has(node.id))
      const movingRect = unionWorkspaceNodeRects(movingNodes)
      if (!movingRect) {
        return draggedNodePositionById
      }

      const snapped = resolveWorkspaceSnap({
        movingRect,
        candidateRects: resolveWorkspaceNodeSnapCandidateRects({
          movingNodeIds,
          nodes: currentNodes,
          spaces: spacesRef.current,
        }),
        grid: WORKSPACE_ARRANGE_GRID_PX,
        threshold: 8,
        enableGrid: true,
        enableObject: true,
      })

      if (snapped.dx === 0 && snapped.dy === 0) {
        return draggedNodePositionById
      }

      const snappedPositionById = new Map<string, { x: number; y: number }>()

      for (const nodeId of draggedNodeIds) {
        const basePosition =
          draggedNodePositionById.get(nodeId) ??
          fallbackNodes.find(node => node.id === nodeId)?.position ??
          reactFlow.getNode(nodeId)?.position

        if (!basePosition) {
          continue
        }

        const nextPosition = {
          x: basePosition.x + snapped.dx,
          y: basePosition.y + snapped.dy,
        }

        snappedPositionById.set(nodeId, nextPosition)
      }

      const selectedSpaceIds = dragSelectedSpaceIdsRef.current ?? selectedSpaceIdsRef.current
      const selectedSpaceIdSet = new Set(selectedSpaceIds)
      const movedSpaceIds = new Set<string>()

      if (selectedSpaceIdSet.size > 0) {
        const previousSpaces = spacesRef.current
        let hasSpaceMoved = false

        const nextSpaces = previousSpaces.map(space => {
          if (!selectedSpaceIdSet.has(space.id) || !space.rect) {
            return space
          }

          movedSpaceIds.add(space.id)
          hasSpaceMoved = true
          return {
            ...space,
            rect: {
              ...space.rect,
              x: space.rect.x + snapped.dx,
              y: space.rect.y + snapped.dy,
            },
          }
        })

        if (hasSpaceMoved) {
          onSpacesChange(nextSpaces)
        }
      }

      const ownedNodeIdsToShift = new Set<string>()
      if (movedSpaceIds.size > 0) {
        for (const space of spacesRef.current) {
          if (!movedSpaceIds.has(space.id)) {
            continue
          }

          for (const nodeId of space.nodeIds) {
            if (movingNodeIds.has(nodeId)) {
              continue
            }

            ownedNodeIdsToShift.add(nodeId)
          }
        }
      }

      setNodes(
        prevNodes => {
          let hasChanged = false
          const nextNodes = prevNodes.map(node => {
            const snappedPosition = snappedPositionById.get(node.id)
            if (snappedPosition) {
              if (node.position.x === snappedPosition.x && node.position.y === snappedPosition.y) {
                return node
              }

              hasChanged = true
              return {
                ...node,
                position: snappedPosition,
              }
            }

            if (!ownedNodeIdsToShift.has(node.id)) {
              return node
            }

            const nextPosition = {
              x: node.position.x + snapped.dx,
              y: node.position.y + snapped.dy,
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

      return snappedPositionById.size > 0 ? snappedPositionById : draggedNodePositionById
    },
    [dragSelectedSpaceIdsRef, onSpacesChange, reactFlow, selectedSpaceIdsRef, setNodes, spacesRef],
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
      const selectedNodes = nodes.filter(candidate => candidate.selected)
      const draggedNodes = selectedNodes.length > 0 ? selectedNodes : [node]
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
      const snappedNodePositionById = resolveSnappedDraggedNodePositions(
        draggedNodeIds,
        draggedNodePositionById,
        fallbackNodes,
      )

      applyOwnershipForDrop({
        draggedNodeIds,
        draggedNodePositionById: snappedNodePositionById,
        dragStartNodePositionById,
        dropFlowPoint: dropPoint,
      })
      dragSelectedSpaceIdsRef.current = null
    },
    [applyOwnershipForDrop, dragSelectedSpaceIdsRef, reactFlow, resolveSnappedDraggedNodePositions],
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
      const snappedNodePositionById = resolveSnappedDraggedNodePositions(
        draggedNodeIds,
        draggedNodePositionById,
        fallbackNodes,
      )

      applyOwnershipForDrop({
        draggedNodeIds,
        draggedNodePositionById: snappedNodePositionById,
        dragStartNodePositionById,
        dropFlowPoint: dropPoint,
      })
      dragSelectedSpaceIdsRef.current = null
    },
    [applyOwnershipForDrop, dragSelectedSpaceIdsRef, reactFlow, resolveSnappedDraggedNodePositions],
  )

  return {
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
  }
}
