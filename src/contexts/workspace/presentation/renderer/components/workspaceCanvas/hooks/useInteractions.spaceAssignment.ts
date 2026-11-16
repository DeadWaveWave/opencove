import type { Node } from '@xyflow/react'
import { resolveInnermostSpaceAtPoint } from '@contexts/space/application/spaceContainment'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import { expandSpaceToFitOwnedNodesAndPushAway } from '../../../utils/spaceAutoResize'
import { sanitizeSpaces } from '../helpers'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'
import { useCanvasCollapseStore } from '../../../store/useCanvasCollapseStore'
import { EMPTY_CANVAS_COLLAPSE } from '../../../utils/canvasCollapse'
import {
  projectCanvasInteractionLayout,
  restoreCanvasInteractionLayout,
} from '../../../utils/canvasInteractionLayout'

export function findContainingSpaceByAnchor(
  spaces: WorkspaceSpaceState[],
  anchor: Point,
): WorkspaceSpaceState | null {
  return resolveInnermostSpaceAtPoint(spaces, anchor)
}

/**
 * Assigns a node that a creator has just added, and flushed, to its Space, grows the Space to fit
 * and pushes its neighbours away. It is one store write, computed from the nodes and the Spaces of
 * the document when the write runs: the creator's own writes, and any other write that landed
 * since, are in the layout. The collapse state is not part of the document and is read once,
 * before. It writes the Spaces always and the nodes only when a position moved, and it asks for no
 * flush and no terminal layout sync.
 */
export function assignNodeToSpaceAndExpand({
  workspaceId,
  createdNodeId,
  createdNode,
  targetSpaceId,
  targetSpaceSnapshot,
  targetSpaceBaseline,
  workspaceSpacesSnapshot,
  updateCanvasDocument,
}: {
  workspaceId?: string
  createdNodeId: string
  createdNode: Node<TerminalNodeData>
  targetSpaceId: string
  targetSpaceSnapshot?: WorkspaceSpaceState | null
  targetSpaceBaseline?: WorkspaceSpaceState | null
  workspaceSpacesSnapshot?: WorkspaceSpaceState[] | null
  updateCanvasDocument: UseWorkspaceCanvasNodesStoreResult['updateCanvasDocument']
}): void {
  const collapse =
    (workspaceId && useCanvasCollapseStore.getState().workspaces[workspaceId]) ||
    EMPTY_CANVAS_COLLAPSE

  updateCanvasDocument(
    ({ nodes, spaces }) => {
      const baseSpaces = mergeTargetSpaceSnapshot({
        spaces,
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

      const layoutNodes = hasUsableLayoutRect(createdNode)
        ? [...nodes.filter(node => node.id !== createdNode.id), createdNode]
        : nodes
      const presented = projectCanvasInteractionLayout(layoutNodes, nextSpaces, collapse)
      const expanded = expandSpaceToFitOwnedNodesAndPushAway({
        targetSpaceId,
        spaces: presented.spaces,
        nodeRects: presented.nodes.map(node => ({
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
      const { nextSpaces: pushedSpaces, nextNodePositionById: nodePositionById } =
        restoreCanvasInteractionLayout(
          { nextSpaces: expanded.spaces, nextNodePositionById: expanded.nodePositionById },
          layoutNodes,
          nextSpaces,
          collapse,
        )

      if (nodePositionById.size === 0) {
        return { nodes, spaces: pushedSpaces }
      }

      let hasChanged = false
      const movedNodes = nodes.map(node => {
        const nextPosition = nodePositionById.get(node.id)
        if (!nextPosition) {
          return node
        }

        if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
          return node
        }

        hasChanged = true
        return { ...node, position: nextPosition }
      })

      return { nodes: hasChanged ? movedNodes : nodes, spaces: pushedSpaces }
    },
    { syncLayout: false },
  )
}

function hasUsableLayoutRect(
  node: Node<TerminalNodeData> | null | undefined,
): node is Node<TerminalNodeData> {
  return Boolean(
    node &&
    Number.isFinite(node.position?.x) &&
    Number.isFinite(node.position?.y) &&
    Number.isFinite(node.data?.width) &&
    Number.isFinite(node.data?.height),
  )
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
