import { useCallback, useRef } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
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
