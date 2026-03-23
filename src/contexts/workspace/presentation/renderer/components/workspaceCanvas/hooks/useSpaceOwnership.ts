import { useCallback, useRef } from 'react'
import { useStoreApi, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import { resolveWorkspaceSnap } from '../../../utils/workspaceSnap'
import {
  resolveWorkspaceNodeSnapCandidateRects,
  unionWorkspaceNodeRects,
} from '../../../utils/workspaceSnap.nodes'
import type { ShowWorkspaceCanvasMessage, SpaceWorktreeMismatchDropWarningState } from '../types'
import {
  collectDraggedNodePositions,
  resolveSpaceAtPoint as resolveSpaceAtPointFromHelpers,
} from './useSpaceOwnership.drop.helpers'
import { type SetNodes } from './useSpaceOwnership.helpers'
import { useWorkspaceCanvasApplyOwnershipForDrop } from './useSpaceOwnership.applyDrop'
import { useWorkspaceCanvasSpaceOwnershipWorktreeWarning } from './useSpaceOwnership.worktreeWarning'
import { setSortedSelectedSpaceIds } from './useSelectionDraft.helpers'

export function useWorkspaceCanvasSpaceOwnership({
  workspacePath,
  reactFlow,
  spacesRef,
  selectedNodeIdsRef,
  setSelectedNodeIds,
  selectedSpaceIdsRef,
  setSelectedSpaceIds,
  dragSelectedSpaceIdsRef,
  exclusiveNodeDragAnchorIdRef,
  setNodes,
  onSpacesChange,
  onRequestPersistFlush,
  onShowMessage,
  hideWorktreeMismatchDropWarning,
}: {
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  spacesRef: React.MutableRefObject<WorkspaceSpaceState[]>
  selectedNodeIdsRef: React.MutableRefObject<string[]>
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>
  selectedSpaceIdsRef: React.MutableRefObject<string[]>
  setSelectedSpaceIds: React.Dispatch<React.SetStateAction<string[]>>
  dragSelectedSpaceIdsRef: React.MutableRefObject<string[] | null>
  exclusiveNodeDragAnchorIdRef: React.MutableRefObject<string | null>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
  onShowMessage?: ShowWorkspaceCanvasMessage
  hideWorktreeMismatchDropWarning: boolean
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
  spaceWorktreeMismatchDropWarning: SpaceWorktreeMismatchDropWarningState | null
  cancelSpaceWorktreeMismatchDropWarning: () => void
  continueSpaceWorktreeMismatchDropWarning: () => void
} {
  const { t } = useTranslation()
  const reactFlowStore = useStoreApi()
  const dragStartNodeIdsRef = useRef<string[] | null>(null)
  const dragStartNodePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragStartAllNodePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
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

      const fallbackNodeById = new Map(fallbackNodes.map(node => [node.id, node]))
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

      const movingNodes = draggedNodeIds
        .map(nodeId => {
          const node = currentNodes.find(candidate => candidate.id === nodeId)
          if (node) {
            return node
          }

          const fallbackNode = fallbackNodeById.get(nodeId)
          if (!fallbackNode) {
            return null
          }

          const draggedPosition = draggedNodePositionById.get(nodeId)
          return draggedPosition
            ? {
                ...fallbackNode,
                position: draggedPosition,
              }
            : fallbackNode
        })
        .filter((node): node is Node<TerminalNodeData> => Boolean(node))

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
          fallbackNodeById.get(nodeId)?.position ??
          reactFlow.getNode(nodeId)?.position

        if (!basePosition) {
          continue
        }

        snappedPositionById.set(nodeId, {
          x: basePosition.x + snapped.dx,
          y: basePosition.y + snapped.dy,
        })
      }

      return snappedPositionById.size > 0 ? snappedPositionById : draggedNodePositionById
    },
    [reactFlow, spacesRef],
  )

  const {
    requestWorktreeMismatchDropWarning,
    spaceWorktreeMismatchDropWarning,
    cancelSpaceWorktreeMismatchDropWarning,
    continueSpaceWorktreeMismatchDropWarning,
  } = useWorkspaceCanvasSpaceOwnershipWorktreeWarning({
    applyOwnershipForDrop,
    reactFlow,
    resolveDropTargetSpaceAtPoint,
    setNodes,
    hideWorktreeMismatchDropWarning,
    workspacePath,
    t,
  })

  const captureDragStartNodeIds = useCallback(
    (nodes: Node<TerminalNodeData>[]) => {
      dragStartNodeIdsRef.current = nodes.map(node => node.id)
      dragStartNodePositionByIdRef.current = new Map(
        nodes.map(node => [node.id, { x: node.position.x, y: node.position.y }]),
      )
      dragStartAllNodePositionByIdRef.current = new Map(
        reactFlow.getNodes().map(node => [node.id, { x: node.position.x, y: node.position.y }]),
      )
      dragSelectedSpaceIdsRef.current = [...selectedSpaceIdsRef.current]
    },
    [dragSelectedSpaceIdsRef, reactFlow, selectedSpaceIdsRef],
  )

  const handleNodeDragStart = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>, nodes: Node<TerminalNodeData>[]) => {
      const shouldReplaceSelection =
        !event.shiftKey && !selectedNodeIdsRef.current.includes(node.id)

      if (shouldReplaceSelection) {
        exclusiveNodeDragAnchorIdRef.current = node.id

        setNodes(
          prevNodes => {
            let hasChanged = false
            const nextNodes = prevNodes.map(item => {
              const shouldSelect = item.id === node.id
              if (item.selected === shouldSelect) {
                return item
              }

              hasChanged = true
              return { ...item, selected: shouldSelect }
            })

            return hasChanged ? nextNodes : prevNodes
          },
          { syncLayout: false },
        )

        selectedNodeIdsRef.current = [node.id]
        setSelectedNodeIds([node.id])
        setSortedSelectedSpaceIds([], selectedSpaceIdsRef, setSelectedSpaceIds)
        reactFlowStore.setState({
          nodesSelectionActive: true,
          coveDragSurfaceSelectionMode: false,
        } as unknown as Parameters<typeof reactFlowStore.setState>[0])
      } else {
        exclusiveNodeDragAnchorIdRef.current = null
      }

      const draggedNodes = shouldReplaceSelection ? [node] : nodes.length > 0 ? nodes : [node]
      captureDragStartNodeIds(draggedNodes)
    },
    [
      captureDragStartNodeIds,
      exclusiveNodeDragAnchorIdRef,
      reactFlowStore,
      selectedNodeIdsRef,
      selectedSpaceIdsRef,
      setNodes,
      setSelectedNodeIds,
      setSelectedSpaceIds,
    ],
  )

  const handleSelectionDragStart = useCallback(
    (_event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => {
      exclusiveNodeDragAnchorIdRef.current = null
      captureDragStartNodeIds(nodes)
    },
    [captureDragStartNodeIds, exclusiveNodeDragAnchorIdRef],
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
      const dragStartAllNodePositionById = dragStartAllNodePositionByIdRef.current ?? undefined
      dragStartAllNodePositionByIdRef.current = null

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

      const shouldWarn = requestWorktreeMismatchDropWarning({
        draggedNodeIds,
        draggedNodePositionById: snappedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dropFlowPoint: dropPoint,
        fallbackNodes,
      })

      if (!shouldWarn) {
        applyOwnershipForDrop({
          draggedNodeIds,
          draggedNodePositionById: snappedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById,
          dropFlowPoint: dropPoint,
        })
      }
      dragSelectedSpaceIdsRef.current = null
    },
    [
      applyOwnershipForDrop,
      dragSelectedSpaceIdsRef,
      reactFlow,
      requestWorktreeMismatchDropWarning,
      resolveSnappedDraggedNodePositions,
    ],
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
      const dragStartAllNodePositionById = dragStartAllNodePositionByIdRef.current ?? undefined
      dragStartAllNodePositionByIdRef.current = null

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

      const shouldWarn = requestWorktreeMismatchDropWarning({
        draggedNodeIds,
        draggedNodePositionById: snappedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dropFlowPoint: dropPoint,
        fallbackNodes,
      })

      if (!shouldWarn) {
        applyOwnershipForDrop({
          draggedNodeIds,
          draggedNodePositionById: snappedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById,
          dropFlowPoint: dropPoint,
        })
      }
      dragSelectedSpaceIdsRef.current = null
    },
    [
      applyOwnershipForDrop,
      dragSelectedSpaceIdsRef,
      reactFlow,
      requestWorktreeMismatchDropWarning,
      resolveSnappedDraggedNodePositions,
    ],
  )

  return {
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
    spaceWorktreeMismatchDropWarning,
    cancelSpaceWorktreeMismatchDropWarning,
    continueSpaceWorktreeMismatchDropWarning,
  }
}
