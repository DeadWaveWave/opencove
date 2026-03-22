import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import {
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodePositionChange,
} from '@xyflow/react'
import type { TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { cleanupNodeRuntimeArtifacts } from '../../../utils/nodeRuntimeCleanup'
import { WORKSPACE_ARRANGE_GRID_PX } from '../../../utils/workspaceArrange.shared'
import {
  resolveWorkspaceSnap,
  type WorkspaceSnapGuide,
  type WorkspaceSnapRect,
} from '../../../utils/workspaceSnap'

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
  magneticSnappingEnabledRef: MutableRefObject<boolean>
  setSnapGuides: Dispatch<SetStateAction<WorkspaceSnapGuide[] | null>>
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  onRequestPersistFlush?: () => void
}

function toNodeRect(node: Node<TerminalNodeData>): WorkspaceSnapRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.data.width,
    height: node.data.height,
  }
}

function unionNodeRects(nodes: Node<TerminalNodeData>[]): WorkspaceSnapRect | null {
  if (nodes.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.data.width)
    maxY = Math.max(maxY, node.position.y + node.data.height)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function buildNodeOwnerById(spaces: WorkspaceSpaceState[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const space of spaces) {
    for (const nodeId of space.nodeIds) {
      if (!map.has(nodeId)) {
        map.set(nodeId, space.id)
      }
    }
  }
  return map
}

function resolveSnapCandidateRects({
  movingNodeIds,
  nodes,
  spaces,
}: {
  movingNodeIds: Set<string>
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
}): WorkspaceSnapRect[] {
  const ownerByNodeId = buildNodeOwnerById(spaces)
  const movingOwners = new Set<string | null>()

  for (const nodeId of movingNodeIds) {
    movingOwners.add(ownerByNodeId.get(nodeId) ?? null)
  }

  if (movingOwners.size !== 1) {
    return []
  }

  const onlyOwner = [...movingOwners][0] ?? null
  const candidateRects: WorkspaceSnapRect[] = []

  for (const node of nodes) {
    if (movingNodeIds.has(node.id)) {
      continue
    }

    const owner = ownerByNodeId.get(node.id) ?? null
    if (owner !== onlyOwner) {
      continue
    }

    candidateRects.push(toNodeRect(node))
  }

  if (onlyOwner) {
    const ownerSpace = spaces.find(space => space.id === onlyOwner)
    if (ownerSpace?.rect) {
      candidateRects.push(ownerSpace.rect)
    }
  } else {
    for (const space of spaces) {
      if (space.rect) {
        candidateRects.push(space.rect)
      }
    }
  }

  return candidateRects
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
  magneticSnappingEnabledRef,
  setSnapGuides,
  onSpacesChange,
  onRequestPersistFlush,
}: UseApplyNodeChangesParams): (changes: NodeChange<Node<TerminalNodeData>>[]) => void {
  return useCallback(
    (changes: NodeChange<Node<TerminalNodeData>>[]) => {
      const filteredChanges = changes.filter(change => change.type !== 'select')

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
      const movedNodeIds = new Set(
        positionChanges.filter(change => change.position !== undefined).map(change => change.id),
      )

      const settledPositionChanges: NodePositionChange[] = filteredChanges.filter(
        (change): change is NodePositionChange =>
          change.type === 'position' &&
          change.dragging === false &&
          change.position !== undefined &&
          !removedIds.has(change.id),
      )

      if (movedNodeIds.size > 0 && magneticSnappingEnabledRef.current) {
        const movingNodes = nextNodes.filter(node => movedNodeIds.has(node.id))
        const movingRect = unionNodeRects(movingNodes)

        if (movingRect) {
          const snapped = resolveWorkspaceSnap({
            movingRect,
            candidateRects: resolveSnapCandidateRects({
              movingNodeIds: movedNodeIds,
              nodes: nextNodes,
              spaces: spacesRef.current,
            }),
            grid: WORKSPACE_ARRANGE_GRID_PX,
            threshold: 8,
            enableGrid: true,
            enableObject: true,
          })

          if (snapped.dx !== 0 || snapped.dy !== 0) {
            nextNodes = nextNodes.map(node =>
              movedNodeIds.has(node.id)
                ? {
                    ...node,
                    position: {
                      x: node.position.x + snapped.dx,
                      y: node.position.y + snapped.dy,
                    },
                  }
                : node,
            )
          }

          if (isDraggingThisFrame && snapped.guides.length > 0) {
            setSnapGuides(snapped.guides)
          } else if (!isDraggingThisFrame) {
            setSnapGuides(null)
          } else {
            setSnapGuides(null)
          }
        } else {
          setSnapGuides(null)
        }
      } else if (positionChanges.length > 0) {
        setSnapGuides(null)
      }

      if (settledPositionChanges.length > 0) {
        const settledIds = new Set(settledPositionChanges.map(change => change.id))
        nextNodes = nextNodes.map(node => {
          if (!settledIds.has(node.id)) {
            return node
          }

          const resolved = normalizePosition(node.id, node.position, {
            width: node.data.width,
            height: node.data.height,
          })

          return {
            ...node,
            position: resolved,
          }
        })
      }

      const anchorChange = positionChanges.find(change => change.position !== undefined) ?? null
      const activeSelectedSpaceIds = dragSelectedSpaceIdsRef?.current ?? selectedSpaceIdsRef.current
      const hasSelectedSpaces = activeSelectedSpaceIds.length > 0
      const shouldSyncSelectedSpaces = hasSelectedSpaces && anchorChange !== null

      if (shouldSyncSelectedSpaces) {
        const prevAnchor = currentNodes.find(node => node.id === anchorChange.id) ?? null
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

      if (positionChanges.length > 0) {
        isNodeDraggingRef.current = isDraggingThisFrame
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
      isNodeDraggingRef,
      nodesRef,
      normalizePosition,
      magneticSnappingEnabledRef,
      onNodesChange,
      onRequestPersistFlush,
      onSpacesChange,
      setSnapGuides,
      dragSelectedSpaceIdsRef,
      selectedSpaceIdsRef,
      spacesRef,
    ],
  )
}
