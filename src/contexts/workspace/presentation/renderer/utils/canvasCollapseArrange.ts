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
import {
  canRestoreCollapsedArrangement,
  createCollapseArrangeSnapshot,
  type CollapseArrangeSnapshot,
} from './canvasCollapseArrange.snapshot'
import { SPACE_FRAME_MIN_WIDTH } from './spaceLayout'
export {
  canRestoreCollapsedArrangement,
  type CollapseArrangeSnapshot,
} from './canvasCollapseArrange.snapshot'

const PADDING = 24
const GAP = 16

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
    const cardWidth = members.length ? getCollapsedNodeSize().width : 0
    const availableWidth = Math.max(
      rect.width,
      cardWidth ? cardWidth + PADDING * 2 : 0,
      ...children.map(child => child.x + child.width + 12 - rect.x),
    )
    const columns = Math.max(
      1,
      Math.min(
        members.length,
        Math.floor((availableWidth - PADDING * 2 + GAP) / (cardWidth + GAP)),
      ),
    )
    const width = Math.max(
      SPACE_FRAME_MIN_WIDTH,
      members.length ? columns * cardWidth + (columns - 1) * GAP + PADDING * 2 : 0,
      ...children.map(child => child.x + child.width + 12 - rect.x),
    )
    let y = Math.max(rect.y + PADDING, ...children.map(child => child.y + child.height + GAP))
    let bottom = Math.max(
      rect.y + PADDING * 2,
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
      const rowHeight = getCollapsedNodeSize().height
      bottom = Math.max(bottom, y + rowHeight + PADDING)
      y += rowHeight + GAP
    }
    rects.set(space.id, { ...rect, width, height: bottom - rect.y })
  }

  const nextNodes = nodes.map(node => {
    const position = positions.get(node.id)
    return position && (node.position.x !== position.x || node.position.y !== position.y)
      ? { ...node, position }
      : node
  })
  // If this was a child Space, expand its ancestors without relocating unrelated windows.
  fitFrames(spaces, nextNodes, rects, affected, collapsedNodeIds)
  const nextSpaces = withFrames(spaces, rects, affected)
  const collapsedSpaceIds = Object.fromEntries(
    Object.entries(collapse.collapsedSpaceIds).filter(([id]) => !descendants.has(id)),
  )
  const nextState = { collapsedNodeIds, collapsedSpaceIds }
  if (
    nextNodes.every((node, index) => node === nodes[index]) &&
    nextSpaces.every((space, index) => space === spaces[index]) &&
    [...ids].every(id => collapse.collapsedNodeIds[id]) &&
    ![...descendants].some(id => collapse.collapsedSpaceIds[id])
  ) {
    return null
  }
  return {
    nodes: nextNodes,
    spaces: nextSpaces,
    state: nextState,
    snapshot: createCollapseArrangeSnapshot({
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
    }),
  }
}

export function restoreCollapsedArrangement(
  snapshot: CollapseArrangeSnapshot,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): Arrangement {
  if (!canRestoreCollapsedArrangement(snapshot, nodes, spaces, state)) {
    return { nodes, spaces, state }
  }
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
  // Preserve containment when a child Space was coherently translated after arranging.
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
  return spaces.map(space => {
    const rect = ids.has(space.id) ? rects.get(space.id) : undefined
    return rect &&
      (rect.x !== space.rect?.x ||
        rect.y !== space.rect?.y ||
        rect.width !== space.rect?.width ||
        rect.height !== space.rect?.height)
      ? { ...space, rect }
      : space
  })
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
  const parent = rects.get(parentId)
  for (const child of spaces.filter(space => space.parentSpaceId === parentId)) {
    const current = rects.get(child.id)
    if (!current) {
      continue
    }
    const x = Math.max(current.x, (parent?.x ?? current.x - 12) + 12)
    let y = Math.max(current.y, (parent?.y ?? current.y - 12) + 12)
    // Existing order wins; only a newly overlapping sibling is moved down.
    for (let changed = true; changed; ) {
      changed = false
      for (const frame of placed) {
        if (
          x < frame.x + frame.width + GAP &&
          x + current.width + GAP > frame.x &&
          y < frame.y + frame.height + GAP &&
          y + current.height + GAP > frame.y
        ) {
          y = frame.y + frame.height + GAP
          changed = true
        }
      }
    }
    const dx = x - current.x
    const dy = y - current.y
    if (dx !== 0 || dy !== 0) {
      const childIds = collectSpaceDescendantIds(child.id, spaces)
      for (const id of childIds) {
        const frame = rects.get(id)
        if (frame) {
          rects.set(id, { ...frame, x: frame.x + dx, y: frame.y + dy })
        }
      }
      const nodeIds = collectSpaceNodeIds(child.id, spaces)
      for (const node of nodes) {
        if (!nodeIds.has(node.id)) {
          continue
        }
        const position = positions.get(node.id) ?? node.position
        positions.set(node.id, { x: position.x + dx, y: position.y + dy })
      }
    }
    placed.push(rects.get(child.id)!)
  }
}
