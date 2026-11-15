import { useCallback, useRef } from 'react'
import { useStoreApi, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../../../types'
import { projectCanvasInteractionLayout } from '../../../utils/canvasInteractionLayout'
import {
  readCanvasInteractionState,
  resolveSnappedCanvasDropPositions,
} from './useNodeDragSession.collapse'
import type { ShowWorkspaceCanvasMessage, SpaceWorktreeMismatchDropWarningState } from '../types'
import {
  collectDraggedNodePositions,
  resolveSpaceAtPoint as resolveSpaceAtPointFromHelpers,
} from './useSpaceOwnership.drop.helpers'
import { type SetNodes } from './useSpaceOwnership.helpers'
import { useWorkspaceCanvasApplyOwnershipForDrop } from './useSpaceOwnership.applyDrop'
import { useWorkspaceCanvasSpaceOwnershipWorktreeWarning } from './useSpaceOwnership.worktreeWarning'
import type { WorkspaceCanvasNodeDragSession } from './useNodeDragSession.types'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import {
  useCanvasSelectionCommands,
  useReadCanvasDocument,
} from '../../../store/canvasStoreContext'
export function useWorkspaceCanvasSpaceOwnership({
  workspaceId,
  workspacePath,
  reactFlow,
  nodeDragSession,
  exclusiveNodeDragAnchorIdRef,
  setNodes,
  updateCanvasDocument,
  onShowMessage,
  hideWorktreeMismatchDropWarning,
  nodeDragPointerAnchorRef,
}: {
  workspaceId?: string
  workspacePath: string
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  nodeDragSession: Pick<
    WorkspaceCanvasNodeDragSession,
    'captureDragStartSpaceSelection' | 'getDragStartSpaceSelection' | 'clearDragStartSpaceSelection'
  >
  exclusiveNodeDragAnchorIdRef: React.MutableRefObject<string | null>
  setNodes: SetNodes
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
  onShowMessage?: ShowWorkspaceCanvasMessage
  hideWorktreeMismatchDropWarning: boolean
  nodeDragPointerAnchorRef?: React.MutableRefObject<{
    nodeId: string
    offset: { x: number; y: number }
  } | null>
}): {
  finalizeDraggedNodeDrop: (input: {
    draggedNodeIds: string[]
    draggedNodePositionById: Map<string, { x: number; y: number }>
    dragStartNodePositionById: Map<string, { x: number; y: number }>
    dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
    dragStartSpaceRectById?: Map<string, WorkspaceSpaceRect>
    dropFlowPoint: { x: number; y: number }
    fallbackNodes: Node<TerminalNodeData>[]
    spaceRectOverrideById?: ReadonlyMap<string, WorkspaceSpaceRect> | null
  }) => void
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
  const selection = useCanvasSelectionCommands()
  const readDocument = useReadCanvasDocument()
  const {
    captureDragStartSpaceSelection,
    getDragStartSpaceSelection,
    clearDragStartSpaceSelection,
  } = nodeDragSession
  const dragStartNodeIdsRef = useRef<string[] | null>(null)
  const dragStartNodePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragStartAllNodePositionByIdRef = useRef<Map<string, { x: number; y: number }> | null>(null)
  const dragStartSpaceRectByIdRef = useRef<Map<string, WorkspaceSpaceRect> | null>(null)
  const resolveDropTargetSpaceAtPoint = useCallback(
    (point: { x: number; y: number }): WorkspaceSpaceState | null =>
      resolveSpaceAtPointFromHelpers(
        projectCanvasInteractionLayout(
          reactFlow.getNodes(),
          readDocument().spaces,
          readCanvasInteractionState(workspaceId),
        ).spaces,
        point,
      ),
    [reactFlow, readDocument, workspaceId],
  )

  const applyOwnershipForDrop = useWorkspaceCanvasApplyOwnershipForDrop({
    workspaceId,
    workspacePath,
    reactFlow,
    setNodes,
    updateCanvasDocument,
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
      return resolveSnappedCanvasDropPositions({
        nodes: reactFlow.getNodes(),
        fallbackNodes,
        spaces: readDocument().spaces,
        workspaceId,
        draggedNodeIds,
        draggedNodePositionById,
      })
    },
    [reactFlow, readDocument, workspaceId],
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
      dragStartSpaceRectByIdRef.current = new Map(
        readDocument()
          .spaces.filter(space => Boolean(space.rect))
          .map(space => [space.id, { ...space.rect! }] as const),
      )
      captureDragStartSpaceSelection()
    },
    [captureDragStartSpaceSelection, reactFlow, readDocument],
  )

  const handleNodeDragStart = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>, nodes: Node<TerminalNodeData>[]) => {
      if (nodeDragPointerAnchorRef) {
        if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
          const pointerFlow = reactFlow.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          })
          nodeDragPointerAnchorRef.current = {
            nodeId: node.id,
            offset: {
              x: pointerFlow.x - node.position.x,
              y: pointerFlow.y - node.position.y,
            },
          }
        } else {
          nodeDragPointerAnchorRef.current = null
        }
      }

      // The flag React Flow hands us is the answer to "was it selected before this gesture". The
      // store cannot say: the select batch of the same pointer down has already written it.
      const shouldReplaceSelection = !event.shiftKey && node.selected !== true
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

        selection.select({ nodeIds: [node.id], spaceIds: [] })
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
      nodeDragPointerAnchorRef,
      reactFlow,
      reactFlowStore,
      selection,
      setNodes,
    ],
  )

  const handleSelectionDragStart = useCallback(
    (_event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => {
      exclusiveNodeDragAnchorIdRef.current = null
      if (nodeDragPointerAnchorRef) {
        nodeDragPointerAnchorRef.current = null
      }
      captureDragStartNodeIds(nodes)
    },
    [captureDragStartNodeIds, exclusiveNodeDragAnchorIdRef, nodeDragPointerAnchorRef],
  )

  const finalizeDraggedNodeDrop = useCallback(
    ({
      draggedNodeIds,
      draggedNodePositionById,
      dragStartNodePositionById,
      dragStartAllNodePositionById,
      dragStartSpaceRectById,
      dropFlowPoint,
      fallbackNodes,
      spaceRectOverrideById,
    }: {
      draggedNodeIds: string[]
      draggedNodePositionById: Map<string, { x: number; y: number }>
      dragStartNodePositionById: Map<string, { x: number; y: number }>
      dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
      dragStartSpaceRectById?: Map<string, WorkspaceSpaceRect>
      dropFlowPoint: { x: number; y: number }
      fallbackNodes: Node<TerminalNodeData>[]
      spaceRectOverrideById?: ReadonlyMap<string, WorkspaceSpaceRect> | null
    }) => {
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
        dragStartSpaceRectById,
        dropFlowPoint,
        spaceRectOverrideById,
        fallbackNodes,
      })

      if (!shouldWarn) {
        applyOwnershipForDrop({
          draggedNodeIds,
          draggedNodePositionById: snappedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById,
          dragStartSpaceRectById,
          dropFlowPoint,
          spaceRectOverrideById,
        })
      }
    },
    [applyOwnershipForDrop, requestWorktreeMismatchDropWarning, resolveSnappedDraggedNodePositions],
  )

  const handleNodeDragStop = useCallback(
    (event: React.MouseEvent, node: Node<TerminalNodeData>, nodes: Node<TerminalNodeData>[]) => {
      if (nodeDragPointerAnchorRef) {
        nodeDragPointerAnchorRef.current = null
      }

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
      const dragStartSpaceRectById = dragStartSpaceRectByIdRef.current ?? undefined
      dragStartSpaceRectByIdRef.current = null

      const fallbackNodes = nodes.length > 0 ? nodes : [node]
      const draggedNodeIds =
        recorded && recorded.includes(node.id) && recorded.length > 0
          ? recorded
          : fallbackNodes.map(item => item.id)
      const dragStartSpaceIds = getDragStartSpaceSelection()
      if (dragStartSpaceIds && dragStartSpaceIds.length > 0) {
        clearDragStartSpaceSelection()
        return
      }

      const draggedNodePositionById = collectDraggedNodePositions({
        draggedNodeIds,
        fallbackNodes,
        getNode: nodeId => reactFlow.getNode(nodeId) ?? undefined,
      })

      finalizeDraggedNodeDrop({
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dragStartSpaceRectById,
        dropFlowPoint: dropPoint,
        fallbackNodes,
      })
      clearDragStartSpaceSelection()
    },
    [
      clearDragStartSpaceSelection,
      finalizeDraggedNodeDrop,
      getDragStartSpaceSelection,
      nodeDragPointerAnchorRef,
      reactFlow,
    ],
  )

  const handleSelectionDragStop = useCallback(
    (event: React.MouseEvent, nodes: Node<TerminalNodeData>[]) => {
      if (nodeDragPointerAnchorRef) {
        nodeDragPointerAnchorRef.current = null
      }

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
      const dragStartSpaceRectById = dragStartSpaceRectByIdRef.current ?? undefined
      dragStartSpaceRectByIdRef.current = null

      const fallbackNodes = nodes
      const draggedNodeIds =
        recorded && recorded.length > 0
          ? recorded
          : fallbackNodes.length > 0
            ? fallbackNodes.map(item => item.id)
            : []
      const dragStartSpaceIds = getDragStartSpaceSelection()
      if (dragStartSpaceIds && dragStartSpaceIds.length > 0) {
        clearDragStartSpaceSelection()
        return
      }

      const draggedNodePositionById = collectDraggedNodePositions({
        draggedNodeIds,
        fallbackNodes,
        getNode: nodeId => reactFlow.getNode(nodeId) ?? undefined,
      })

      finalizeDraggedNodeDrop({
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dragStartSpaceRectById,
        dropFlowPoint: dropPoint,
        fallbackNodes,
      })
      clearDragStartSpaceSelection()
    },
    [
      clearDragStartSpaceSelection,
      finalizeDraggedNodeDrop,
      getDragStartSpaceSelection,
      nodeDragPointerAnchorRef,
      reactFlow,
    ],
  )

  return {
    finalizeDraggedNodeDrop,
    handleNodeDragStart,
    handleSelectionDragStart,
    handleNodeDragStop,
    handleSelectionDragStop,
    spaceWorktreeMismatchDropWarning,
    cancelSpaceWorktreeMismatchDropWarning,
    continueSpaceWorktreeMismatchDropWarning,
  }
}
