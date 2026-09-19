import type { Node } from '@xyflow/react'
import {
  collectAncestorSpaces,
  mapNodeIdToOwningSpaceId,
} from '@contexts/space/application/spaceTree'
import type { Point, TerminalNodeData, WorkspaceSpaceRect, WorkspaceSpaceState } from '../types'
import {
  collectSpaceDescendantIds,
  collectSpaceNodeIds,
  getCollapsedNodeSize,
  getNodeDisplaySize,
  setCollapsed,
  type CanvasCollapseState,
} from './canvasCollapse'

const PADDING = 24
const GAP = 16

export interface CollapseArrangeSnapshot {
  spaceId: string
  positions: Record<string, Point>
  ownerByNodeId: Record<string, string>
  frames: Record<
    string,
    {
      parentSpaceId: string | null
      before: WorkspaceSpaceRect
      arranged: WorkspaceSpaceRect
    }
  >
  collapsedNodeIds: CanvasCollapseState['collapsedNodeIds']
}

interface Arrangement {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  state: CanvasCollapseState
}

/** Arrange display cards while retaining runtime sizes and each node's Space owner. */
export function planCollapsedArrangement(
  spaceId: string,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  collapse: CanvasCollapseState,
): (Arrangement & { snapshot: CollapseArrangeSnapshot }) | null {
  if (!spaces.find(space => space.id === spaceId)?.rect) {
    return null
  }
  const ids = collectSpaceNodeIds(spaceId, spaces)
  const descendants = collectSpaceDescendantIds(spaceId, spaces)
  const affected = new Set([
    ...descendants,
    ...collectAncestorSpaces(spaces, spaceId).map(space => space.id),
  ])
  const ownerByNodeId = mapNodeIdToOwningSpaceId(spaces)
  const rects = new Map(
    spaces.flatMap(space => (space.rect ? [[space.id, { ...space.rect }] as const] : [])),
  )
  const positions = new Map<string, Point>()
  const collapsedNodeIds = { ...collapse.collapsedNodeIds }
  for (const id of ids) {
    collapsedNodeIds[id] = true
  }

  for (const space of deepestFirst(spaces, descendants)) {
    const rect = rects.get(space.id)
    if (!rect) {
      continue
    }
    separateChildFrames(space.id, spaces, nodes, rects, positions)
    const children = spaces
      .filter(child => child.parentSpaceId === space.id)
      .flatMap(child => {
        const frame = rects.get(child.id)
        return frame ? [frame] : []
      })
    const members = nodes.filter(node => ownerByNodeId.get(node.id) === space.id)
    const cardWidth = Math.max(0, ...members.map(node => getCollapsedNodeSize(node.data).width))
    const width = Math.max(
      rect.width,
      cardWidth ? cardWidth + PADDING * 2 : 0,
      ...children.map(child => child.x + child.width + 12 - rect.x),
    )
    const columns = Math.max(1, Math.floor((width - PADDING * 2 + GAP) / (cardWidth + GAP)))
    let y = Math.max(rect.y + PADDING, ...children.map(child => child.y + child.height + GAP))
    let bottom = Math.max(
      rect.y + rect.height,
      ...children.map(child => child.y + child.height + 12),
    )
    for (let offset = 0; offset < members.length; offset += columns) {
      const row = members.slice(offset, offset + columns)
      row.forEach((node, column) =>
        positions.set(node.id, {
          x: rect.x + PADDING + column * (cardWidth + GAP),
          y,
        }),
      )
      const rowHeight = Math.max(...row.map(node => getCollapsedNodeSize(node.data).height))
      bottom = Math.max(bottom, y + rowHeight + PADDING)
      y += rowHeight + GAP
    }
    rects.set(space.id, { ...rect, width, height: bottom - rect.y })
  }

  const nextNodes = nodes.map(node =>
    positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node,
  )
  // If this was a child Space, expand its ancestors without relocating unrelated windows.
  fitFrames(spaces, nextNodes, rects, affected, collapsedNodeIds)
  const nextSpaces = withFrames(spaces, rects, affected)
  return {
    nodes: nextNodes,
    spaces: nextSpaces,
    state: {
      collapsedNodeIds,
      collapsedSpaceIds: setCollapsed(collapse.collapsedSpaceIds, spaceId, false),
    },
    snapshot: {
      spaceId,
      positions: Object.fromEntries(
        nodes.filter(node => ids.has(node.id)).map(node => [node.id, { ...node.position }]),
      ),
      ownerByNodeId: Object.fromEntries([...ownerByNodeId].filter(([id]) => ids.has(id))),
      frames: Object.fromEntries(
        spaces.flatMap(space => {
          const arranged = rects.get(space.id)
          return affected.has(space.id) && space.rect && arranged
            ? [
                [
                  space.id,
                  {
                    parentSpaceId: space.parentSpaceId ?? null,
                    before: { ...space.rect },
                    arranged: { ...arranged },
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
    },
  }
}

export function restoreCollapsedArrangement(
  snapshot: CollapseArrangeSnapshot,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): Arrangement {
  const active = new Set([
    ...collectSpaceDescendantIds(snapshot.spaceId, spaces),
    ...collectAncestorSpaces(spaces, snapshot.spaceId).map(space => space.id),
  ])
  const rects = new Map(
    spaces.flatMap(space => (space.rect ? [[space.id, { ...space.rect }] as const] : [])),
  )
  const deltas = new Map<string, Point>()
  for (const space of spaces) {
    const frame = snapshot.frames[space.id]
    if (
      !space.rect ||
      !frame ||
      !active.has(space.id) ||
      (space.parentSpaceId ?? null) !== frame.parentSpaceId
    ) {
      continue
    }
    const delta = { x: space.rect.x - frame.arranged.x, y: space.rect.y - frame.arranged.y }
    deltas.set(space.id, delta)
    rects.set(space.id, {
      ...frame.before,
      x: frame.before.x + delta.x,
      y: frame.before.y + delta.y,
      // A later manual resize belongs to the user, not this undo transaction.
      width: space.rect.width === frame.arranged.width ? frame.before.width : space.rect.width,
      height: space.rect.height === frame.arranged.height ? frame.before.height : space.rect.height,
    })
  }
  const ownerByNodeId = mapNodeIdToOwningSpaceId(spaces)
  let collapsedNodeIds = state.collapsedNodeIds
  const nextNodes = nodes.map(node => {
    const previous = snapshot.positions[node.id]
    const owner = ownerByNodeId.get(node.id)
    const delta = owner ? deltas.get(owner) : null
    if (!previous || !delta || snapshot.ownerByNodeId[node.id] !== owner) {
      return node
    }
    collapsedNodeIds = setCollapsed(
      collapsedNodeIds,
      node.id,
      snapshot.collapsedNodeIds[node.id] === true,
    )
    return { ...node, position: { x: previous.x + delta.x, y: previous.y + delta.y } }
  })
  const restoredIds = new Set(deltas.keys())
  // Later-added windows and independently moved child Spaces must remain inside their frame.
  fitFrames(spaces, nextNodes, rects, restoredIds, collapsedNodeIds)
  return {
    nodes: nextNodes,
    spaces: withFrames(spaces, rects, restoredIds),
    state: { ...state, collapsedNodeIds },
  }
}

function deepestFirst(spaces: WorkspaceSpaceState[], ids: Set<string>): WorkspaceSpaceState[] {
  return spaces
    .filter(space => ids.has(space.id))
    .sort(
      (left, right) =>
        collectAncestorSpaces(spaces, right.id).length -
        collectAncestorSpaces(spaces, left.id).length,
    )
}

function withFrames(
  spaces: WorkspaceSpaceState[],
  rects: Map<string, WorkspaceSpaceRect>,
  ids: Set<string>,
) {
  return spaces.map(space =>
    ids.has(space.id) && rects.has(space.id) ? { ...space, rect: rects.get(space.id)! } : space,
  )
}

function fitFrames(
  spaces: WorkspaceSpaceState[],
  nodes: Node<TerminalNodeData>[],
  rects: Map<string, WorkspaceSpaceRect>,
  ids: Set<string>,
  collapsedNodeIds: CanvasCollapseState['collapsedNodeIds'],
): void {
  const ownerByNodeId = mapNodeIdToOwningSpaceId(spaces)
  for (const space of deepestFirst(spaces, ids)) {
    const rect = rects.get(space.id)
    if (!rect) {
      continue
    }
    const contents = [
      ...nodes
        .filter(node => ownerByNodeId.get(node.id) === space.id)
        .map(node => ({
          ...node.position,
          ...getNodeDisplaySize(node, collapsedNodeIds),
          padding: PADDING,
        })),
      ...spaces
        .filter(child => child.parentSpaceId === space.id)
        .flatMap(child => {
          const childRect = rects.get(child.id)
          return childRect ? [{ ...childRect, padding: 12 }] : []
        }),
    ]
    const x = Math.min(rect.x, ...contents.map(item => item.x - item.padding))
    const y = Math.min(rect.y, ...contents.map(item => item.y - item.padding))
    rects.set(space.id, {
      x,
      y,
      width:
        Math.max(rect.x + rect.width, ...contents.map(item => item.x + item.width + item.padding)) -
        x,
      height:
        Math.max(
          rect.y + rect.height,
          ...contents.map(item => item.y + item.height + item.padding),
        ) - y,
    })
  }
}

function separateChildFrames(
  parentId: string,
  spaces: WorkspaceSpaceState[],
  nodes: Node<TerminalNodeData>[],
  rects: Map<string, WorkspaceSpaceRect>,
  positions: Map<string, Point>,
): void {
  const placed: WorkspaceSpaceRect[] = []
  for (const child of spaces.filter(space => space.parentSpaceId === parentId)) {
    const current = rects.get(child.id)
    if (!current) {
      continue
    }
    let y = current.y
    // Existing order wins; only a newly overlapping sibling is moved down.
    for (let changed = true; changed; ) {
      changed = false
      for (const frame of placed) {
        if (
          current.x < frame.x + frame.width + GAP &&
          current.x + current.width + GAP > frame.x &&
          y < frame.y + frame.height + GAP &&
          y + current.height + GAP > frame.y
        ) {
          y = frame.y + frame.height + GAP
          changed = true
        }
      }
    }
    const dy = y - current.y
    if (dy !== 0) {
      const childIds = collectSpaceDescendantIds(child.id, spaces)
      for (const id of childIds) {
        const frame = rects.get(id)
        if (frame) {
          rects.set(id, { ...frame, y: frame.y + dy })
        }
      }
      const nodeIds = collectSpaceNodeIds(child.id, spaces)
      for (const node of nodes) {
        if (!nodeIds.has(node.id)) {
          continue
        }
        const position = positions.get(node.id) ?? node.position
        positions.set(node.id, { ...position, y: position.y + dy })
      }
    }
    placed.push(rects.get(child.id)!)
  }
}
