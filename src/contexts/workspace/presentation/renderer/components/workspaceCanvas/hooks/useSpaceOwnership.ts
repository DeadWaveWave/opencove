import { useCallback, useRef, useState } from 'react'
import { useStoreApi, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import { useTranslation } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ShowWorkspaceCanvasMessage, SpaceWorktreeMismatchDropWarningState } from '../types'
import {
  collectDraggedNodePositions,
  resolveSpaceAtPoint as resolveSpaceAtPointFromHelpers,
} from './useSpaceOwnership.drop.helpers'
import {
  computeBoundingRect,
  restoreSelectionAfterDrop,
  type SetNodes,
} from './useSpaceOwnership.helpers'
import { useWorkspaceCanvasApplyOwnershipForDrop } from './useSpaceOwnership.applyDrop'
import { setSortedSelectedSpaceIds } from './useSelectionDraft.helpers'

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}

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
  const pendingWorktreeMismatchDropRef = useRef<{
    draggedNodeIds: string[]
    draggedNodePositionById: Map<string, { x: number; y: number }>
    dragStartNodePositionById: Map<string, { x: number; y: number }>
    dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
    dropFlowPoint: { x: number; y: number }
  } | null>(null)
  const [spaceWorktreeMismatchDropWarning, setSpaceWorktreeMismatchDropWarning] =
    useState<SpaceWorktreeMismatchDropWarningState | null>(null)

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

  const cancelSpaceWorktreeMismatchDropWarning = useCallback(() => {
    pendingWorktreeMismatchDropRef.current = null
    setSpaceWorktreeMismatchDropWarning(null)
  }, [])

  const continueSpaceWorktreeMismatchDropWarning = useCallback(() => {
    const pending = pendingWorktreeMismatchDropRef.current
    pendingWorktreeMismatchDropRef.current = null
    setSpaceWorktreeMismatchDropWarning(null)
    if (!pending) {
      return
    }

    applyOwnershipForDrop(
      {
        draggedNodeIds: pending.draggedNodeIds,
        draggedNodePositionById: pending.draggedNodePositionById,
        dragStartNodePositionById: pending.dragStartNodePositionById,
        dragStartAllNodePositionById: pending.dragStartAllNodePositionById,
        dropFlowPoint: pending.dropFlowPoint,
      },
      { allowDirectoryMismatch: true },
    )
  }, [applyOwnershipForDrop])

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

  const requestWorktreeMismatchDropWarning = useCallback(
    ({
      draggedNodeIds,
      draggedNodePositionById,
      dragStartNodePositionById,
      dragStartAllNodePositionById,
      dropFlowPoint,
      fallbackNodes,
    }: {
      draggedNodeIds: string[]
      draggedNodePositionById: Map<string, { x: number; y: number }>
      dragStartNodePositionById: Map<string, { x: number; y: number }>
      dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
      dropFlowPoint: { x: number; y: number }
      fallbackNodes: Array<Node<TerminalNodeData>>
    }): boolean => {
      const fallbackNodeById = new Map(fallbackNodes.map(node => [node.id, node]))
      const draggedNodesForTarget = draggedNodeIds
        .map(nodeId => {
          const node = reactFlow.getNode(nodeId) ?? fallbackNodeById.get(nodeId)
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
        draggedDropRect && draggedNodeIds.length > 1
          ? {
              x: draggedDropRect.x + draggedDropRect.width / 2,
              y: draggedDropRect.y + draggedDropRect.height / 2,
            }
          : dropFlowPoint
      const targetSpace = resolveDropTargetSpaceAtPoint(dropTargetPoint)
      const targetDirectory =
        targetSpace && targetSpace.directoryPath.trim().length > 0
          ? targetSpace.directoryPath
          : workspacePath

      if (hideWorktreeMismatchDropWarning) {
        return false
      }

      const normalizedTargetDirectory = normalizeComparablePath(targetDirectory)
      const movedNodeIds: string[] = []
      let agentCount = 0
      let terminalCount = 0

      for (const nodeId of draggedNodeIds) {
        const node = reactFlow.getNode(nodeId) ?? fallbackNodeById.get(nodeId)
        if (!node) {
          continue
        }

        if (node.data.kind === 'agent' && node.data.agent) {
          const executionDirectory = node.data.agent.executionDirectory.trim() || workspacePath
          const expectedDirectory = node.data.agent.expectedDirectory?.trim() || executionDirectory
          if (
            normalizeComparablePath(expectedDirectory) !== normalizedTargetDirectory &&
            normalizeComparablePath(executionDirectory) !== normalizedTargetDirectory
          ) {
            movedNodeIds.push(nodeId)
            agentCount += 1
          }
          continue
        }

        if (node.data.kind === 'terminal') {
          const executionDirectory =
            typeof node.data.executionDirectory === 'string' && node.data.executionDirectory.trim()
              ? node.data.executionDirectory.trim()
              : workspacePath
          const expectedDirectory =
            typeof node.data.expectedDirectory === 'string' && node.data.expectedDirectory.trim()
              ? node.data.expectedDirectory.trim()
              : executionDirectory
          if (
            normalizeComparablePath(expectedDirectory) !== normalizedTargetDirectory &&
            normalizeComparablePath(executionDirectory) !== normalizedTargetDirectory
          ) {
            movedNodeIds.push(nodeId)
            terminalCount += 1
          }
        }
      }

      if (movedNodeIds.length === 0 || agentCount + terminalCount === 0) {
        return false
      }

      pendingWorktreeMismatchDropRef.current = {
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dropFlowPoint,
      }

      setSpaceWorktreeMismatchDropWarning({
        spaceId: targetSpace?.id ?? '__workspace-root__',
        spaceName: targetSpace?.name ?? t('worktree.workspaceRoot'),
        agentCount,
        terminalCount,
      })

      const nodeIdSet = new Set(draggedNodeIds)
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

      restoreSelectionAfterDrop({ selectedNodeIds: draggedNodeIds, setNodes })

      return true
    },
    [
      hideWorktreeMismatchDropWarning,
      reactFlow,
      resolveDropTargetSpaceAtPoint,
      setNodes,
      t,
      workspacePath,
    ],
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

      const shouldWarn = requestWorktreeMismatchDropWarning({
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dropFlowPoint: dropPoint,
        fallbackNodes,
      })

      if (!shouldWarn) {
        applyOwnershipForDrop({
          draggedNodeIds,
          draggedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById,
          dropFlowPoint: dropPoint,
        })
      }
      dragSelectedSpaceIdsRef.current = null
    },
    [applyOwnershipForDrop, dragSelectedSpaceIdsRef, reactFlow, requestWorktreeMismatchDropWarning],
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

      const shouldWarn = requestWorktreeMismatchDropWarning({
        draggedNodeIds,
        draggedNodePositionById,
        dragStartNodePositionById,
        dragStartAllNodePositionById,
        dropFlowPoint: dropPoint,
        fallbackNodes,
      })

      if (!shouldWarn) {
        applyOwnershipForDrop({
          draggedNodeIds,
          draggedNodePositionById,
          dragStartNodePositionById,
          dragStartAllNodePositionById,
          dropFlowPoint: dropPoint,
        })
      }
      dragSelectedSpaceIdsRef.current = null
    },
    [applyOwnershipForDrop, dragSelectedSpaceIdsRef, reactFlow, requestWorktreeMismatchDropWarning],
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
