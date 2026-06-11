import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { sanitizeSpaces } from '../helpers'

interface SetNodes {
  (
    updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
    options?: { syncLayout?: boolean },
  ): void
}

export function findContainingSpaceByAnchor(
  spaces: WorkspaceSpaceState[],
  anchor: Point,
): WorkspaceSpaceState | null {
  return resolveInnermostSpaceAtPoint(spaces, anchor)
}

export function assignNodeToSpaceAndExpand({
  createdNodeId,
  targetSpaceId,
  targetSpaceSnapshot,
  targetSpaceBaseline,
  workspaceSpacesSnapshot,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  createdNodeId: string
  targetSpaceId: string
  targetSpaceSnapshot?: WorkspaceSpaceState | null
  targetSpaceBaseline?: WorkspaceSpaceState | null
  workspaceSpacesSnapshot?: WorkspaceSpaceState[] | null
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): void {
  const baseSpaces = mergeTargetSpaceSnapshot({
    spaces: spacesRef.current,
    targetSpaceId,
    snapshot: targetSpaceSnapshot,
    baseline: targetSpaceBaseline,
    workspaceSpacesSnapshot,
  })
  const nextSpaces = sanitizeSpaces(
    baseSpaces.map(space => {
      const filtered = space.nodeIds.filter(nodeId => nodeId !== createdNodeId)

      if (space.id !== targetSpaceId) {
        return { ...space, nodeIds: filtered }
      }

      return { ...space, nodeIds: [...new Set([...filtered, createdNodeId])] }
    }),
  )

  const { spaces: pushedSpaces, nodePositionById } = expandSpaceToFitOwnedNodesAndPushAway({
    targetSpaceId,
    spaces: nextSpaces,
    nodeRects: nodesRef.current.map(node => ({
      id: node.id,
      rect: {
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
      },
    })),
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

  spacesRef.current = pushedSpaces
  onSpacesChange(pushedSpaces)
}

function mergeTargetSpaceSnapshot({
  spaces,
  targetSpaceId,
  snapshot,
  baseline,
  workspaceSpacesSnapshot,
}: {
  spaces: WorkspaceSpaceState[]
  targetSpaceId: string
  snapshot: WorkspaceSpaceState | null | undefined
  baseline: WorkspaceSpaceState | null | undefined
  workspaceSpacesSnapshot: WorkspaceSpaceState[] | null | undefined
}): WorkspaceSpaceState[] {
  if (!snapshot || snapshot.id !== targetSpaceId) {
    return spaces
  }

  if (!spaces.some(space => space.id === targetSpaceId)) {
    const snapshotSpaces =
      Array.isArray(workspaceSpacesSnapshot) &&
      workspaceSpacesSnapshot.some(space => space.id === targetSpaceId)
        ? workspaceSpacesSnapshot
        : null
    const existingSpaceIds = new Set(spaces.map(space => space.id))
    const baseSpaces = snapshotSpaces
      ? [...spaces, ...snapshotSpaces.filter(space => !existingSpaceIds.has(space.id))]
      : [...spaces, snapshot]

    return baseSpaces.map(space =>
      space.id === targetSpaceId ? applyTargetSpaceSnapshot(space, snapshot) : space,
    )
  }

  let foundTarget = false
  const nextSpaces = spaces.map(space => {
    if (space.id !== targetSpaceId) {
      return space
    }

    foundTarget = true
    if (!shouldApplyTargetSpaceSnapshot(space, baseline)) {
      return space
    }

    return applyTargetSpaceSnapshot(space, snapshot)
  })

  return foundTarget ? nextSpaces : [...nextSpaces, snapshot]
}

function applyTargetSpaceSnapshot(
  current: WorkspaceSpaceState,
  snapshot: WorkspaceSpaceState,
): WorkspaceSpaceState {
  return {
    ...current,
    name: snapshot.name,
    directoryPath: snapshot.directoryPath,
    targetMountId: snapshot.targetMountId,
    parentSpaceId: snapshot.parentSpaceId ?? null,
    boundary: snapshot.boundary ?? null,
    sortOrder: snapshot.sortOrder ?? current.sortOrder,
  }
}

function shouldApplyTargetSpaceSnapshot(
  current: WorkspaceSpaceState,
  baseline: WorkspaceSpaceState | null | undefined,
): boolean {
  if (!baseline || baseline.id !== current.id) {
    return false
  }

  return (
    current.name === baseline.name &&
    current.directoryPath === baseline.directoryPath &&
    current.targetMountId === baseline.targetMountId &&
    (current.parentSpaceId ?? null) === (baseline.parentSpaceId ?? null) &&
    (current.sortOrder ?? null) === (baseline.sortOrder ?? null) &&
    JSON.stringify(current.boundary ?? null) === JSON.stringify(baseline.boundary ?? null)
  )
}
