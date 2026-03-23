import { useCallback, useRef, useState } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { SpaceWorktreeMismatchDropWarningState } from '../types'
import {
  computeBoundingRect,
  restoreSelectionAfterDrop,
  type SetNodes,
} from './useSpaceOwnership.helpers'

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/[\\/]+$/, '')
}

interface SpaceOwnershipDropInput {
  draggedNodeIds: string[]
  draggedNodePositionById: Map<string, { x: number; y: number }>
  dragStartNodePositionById: Map<string, { x: number; y: number }>
  dragStartAllNodePositionById?: Map<string, { x: number; y: number }>
  dropFlowPoint: { x: number; y: number }
}

interface SpaceOwnershipWarningRequest extends SpaceOwnershipDropInput {
  fallbackNodes: Array<Node<TerminalNodeData>>
}

export function useWorkspaceCanvasSpaceOwnershipWorktreeWarning({
  applyOwnershipForDrop,
  reactFlow,
  resolveDropTargetSpaceAtPoint,
  setNodes,
  hideWorktreeMismatchDropWarning,
  workspacePath,
  t,
}: {
  applyOwnershipForDrop: (
    input: SpaceOwnershipDropInput,
    options?: { allowDirectoryMismatch?: boolean },
  ) => void
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  resolveDropTargetSpaceAtPoint: (point: { x: number; y: number }) => WorkspaceSpaceState | null
  setNodes: SetNodes
  hideWorktreeMismatchDropWarning: boolean
  workspacePath: string
  t: TranslateFn
}): {
  requestWorktreeMismatchDropWarning: (input: SpaceOwnershipWarningRequest) => boolean
  spaceWorktreeMismatchDropWarning: SpaceWorktreeMismatchDropWarningState | null
  cancelSpaceWorktreeMismatchDropWarning: () => void
  continueSpaceWorktreeMismatchDropWarning: () => void
} {
  const pendingWorktreeMismatchDropRef = useRef<SpaceOwnershipDropInput | null>(null)
  const [spaceWorktreeMismatchDropWarning, setSpaceWorktreeMismatchDropWarning] =
    useState<SpaceWorktreeMismatchDropWarningState | null>(null)

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

    applyOwnershipForDrop(pending, { allowDirectoryMismatch: true })
  }, [applyOwnershipForDrop])

  const requestWorktreeMismatchDropWarning = useCallback(
    ({
      draggedNodeIds,
      draggedNodePositionById,
      dragStartNodePositionById,
      dragStartAllNodePositionById,
      dropFlowPoint,
      fallbackNodes,
    }: SpaceOwnershipWarningRequest): boolean => {
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

  return {
    requestWorktreeMismatchDropWarning,
    spaceWorktreeMismatchDropWarning,
    cancelSpaceWorktreeMismatchDropWarning,
    continueSpaceWorktreeMismatchDropWarning,
  }
}
