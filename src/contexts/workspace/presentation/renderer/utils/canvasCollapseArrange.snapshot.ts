import type { Node } from '@xyflow/react'
import { mapNodeIdToOwningSpaceId } from '@contexts/space/application/spaceTree'
import type { Point, TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import { collectSpaceDescendantIds, type CanvasCollapseState } from './canvasCollapse'

export interface CollapseArrangeSnapshot {
  spaceId: string
  descendantIds: string[]
  positions: Record<string, Point>
  ownerByNodeId: Record<string, string>
  frames: Record<
    string,
    {
      parentSpaceId: string | null
      nodeIds: string[]
      childSpaceIds: string[]
      before: WorkspaceSpaceRect
      arranged: WorkspaceSpaceRect
    }
  >
  expectedNodes: Record<
    string,
    {
      owner: string
      position: Point
      width: number
      height: number
      kind: TerminalNodeData['kind']
      collapsed: boolean
    }
  >
  collapsedNodeIds: CanvasCollapseState['collapsedNodeIds']
}

export function createCollapseArrangeSnapshot({
  spaceId,
  nodes,
  spaces,
  nextNodes,
  nextSpaces,
  collapse,
  nextState,
  ids,
  descendants,
  affected,
}: {
  spaceId: string
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  nextNodes: Node<TerminalNodeData>[]
  nextSpaces: WorkspaceSpaceState[]
  collapse: CanvasCollapseState
  nextState: CanvasCollapseState
  ids: Set<string>
  descendants: Set<string>
  affected: Set<string>
}): CollapseArrangeSnapshot {
  const owners = mapNodeIdToOwningSpaceId(spaces)
  const nextById = new Map(nextSpaces.map(space => [space.id, space]))
  return {
    spaceId,
    descendantIds: [...descendants],
    positions: Object.fromEntries(
      nodes.filter(node => ids.has(node.id)).map(node => [node.id, { ...node.position }]),
    ),
    ownerByNodeId: Object.fromEntries([...owners].filter(([id]) => ids.has(id))),
    frames: Object.fromEntries(
      spaces.flatMap(space => {
        const arranged = nextById.get(space.id)?.rect
        return affected.has(space.id) && space.rect && arranged
          ? [
              [
                space.id,
                {
                  parentSpaceId: space.parentSpaceId ?? null,
                  nodeIds: [...space.nodeIds],
                  childSpaceIds: spaces
                    .filter(child => child.parentSpaceId === space.id)
                    .map(child => child.id),
                  before: { ...space.rect },
                  arranged: { ...arranged },
                },
              ],
            ]
          : []
      }),
    ),
    expectedNodes: Object.fromEntries(
      nextNodes.flatMap(node => {
        const owner = owners.get(node.id)
        return owner && affected.has(owner)
          ? [
              [
                node.id,
                {
                  owner,
                  position: { ...node.position },
                  width: node.data.width,
                  height: node.data.height,
                  kind: node.data.kind,
                  collapsed: nextState.collapsedNodeIds[node.id] === true,
                },
              ],
            ]
          : []
      }),
    ),
    collapsedNodeIds: Object.fromEntries(
      nodes
        .filter(node => ids.has(node.id) && collapse.collapsedNodeIds[node.id])
        .map(node => [node.id, true]),
    ),
  }
}

function sameIds(left: string[], right: string[]): boolean {
  const ids = new Set(left)
  return ids.size === new Set(right).size && right.every(id => ids.has(id))
}

/** Undo is a layout transaction, not permission to overwrite newer geometry or disclosure. */
export function canRestoreCollapsedArrangement(
  snapshot: CollapseArrangeSnapshot,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): boolean {
  if (!sameIds(snapshot.descendantIds, [...collectSpaceDescendantIds(snapshot.spaceId, spaces)])) {
    return false
  }
  const byId = new Map(spaces.map(space => [space.id, space]))
  const deltas = new Map<string, Point>()
  for (const [id, frame] of Object.entries(snapshot.frames)) {
    const space = byId.get(id)
    if (
      !space?.rect ||
      (space.parentSpaceId ?? null) !== frame.parentSpaceId ||
      !sameIds(space.nodeIds, frame.nodeIds) ||
      !sameIds(
        spaces.filter(child => child.parentSpaceId === id).map(child => child.id),
        frame.childSpaceIds,
      ) ||
      space.rect.width !== frame.arranged.width ||
      space.rect.height !== frame.arranged.height
    ) {
      return false
    }
    deltas.set(id, { x: space.rect.x - frame.arranged.x, y: space.rect.y - frame.arranged.y })
  }
  if (snapshot.descendantIds.some(id => state.collapsedSpaceIds[id])) {
    return false
  }
  const nodesById = new Map(nodes.map(node => [node.id, node]))
  const owners = mapNodeIdToOwningSpaceId(spaces)
  for (const [id, expected] of Object.entries(snapshot.expectedNodes)) {
    const node = nodesById.get(id)
    const delta = deltas.get(expected.owner)
    if (
      !node ||
      !delta ||
      owners.get(id) !== expected.owner ||
      node.data.width !== expected.width ||
      node.data.height !== expected.height ||
      node.data.kind !== expected.kind ||
      (state.collapsedNodeIds[id] === true) !== expected.collapsed ||
      Math.abs(node.position.x - expected.position.x - delta.x) > 0.001 ||
      Math.abs(node.position.y - expected.position.y - delta.y) > 0.001
    ) {
      return false
    }
  }
  return true
}
