import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../types'
import {
  collectSpaceDescendantIds,
  collectSpaceNodeIds,
  getCollapsedNodeSize,
  getCollapsedSpaceHiddenIds,
  getCollapsedSpaceSize,
  type CanvasCollapseState,
} from './canvasCollapse'

export function getPresentedNodeSize(data: TerminalNodeData): { width: number; height: number } {
  return data.collapsePresentation?.collapsed ? getCollapsedNodeSize() : data
}

/** Algorithm-only copies. Never pass these nodes to persistence or a runtime component. */
export function projectCanvasInteractionLayout(
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): { nodes: Node<TerminalNodeData>[]; spaces: WorkspaceSpaceState[] } {
  const hidden = getCollapsedSpaceHiddenIds(spaces, state.collapsedSpaceIds)
  const ids = new Set(nodes.map(node => node.id))
  return {
    nodes: nodes
      .filter(node => !hidden.nodeIds.has(node.id))
      .map(node => {
        const collapsed =
          state.collapsedNodeIds[node.id] === true ||
          node.data.collapsePresentation?.collapsed === true
        return collapsed ? { ...node, data: { ...node.data, ...getCollapsedNodeSize() } } : node
      }),
    spaces: spaces
      .filter(space => !hidden.spaceIds.has(space.id))
      .map(space => {
        if (!state.collapsedSpaceIds[space.id] || !space.rect) {
          return space
        }
        const count = [...collectSpaceNodeIds(space.id, spaces)].filter(id => ids.has(id)).length
        return { ...space, rect: { ...space.rect, ...getCollapsedSpaceSize(count) } }
      }),
  }
}

/** Carry positions and ownership back; expanded geometry remains the durable truth. */
export function restoreCanvasInteractionLayout<
  T extends {
    nextSpaces: WorkspaceSpaceState[]
    nextNodePositionById: Map<string, Point>
  },
>(
  projected: T,
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): T {
  const hidden = getCollapsedSpaceHiddenIds(spaces, state.collapsedSpaceIds)
  const byId = new Map(projected.nextSpaces.map(space => [space.id, space]))
  const movedHiddenNodes = new Map<string, Point>()
  const movedHiddenSpaces = new Map<string, Point>()
  for (const space of spaces) {
    if (!space.rect || !state.collapsedSpaceIds[space.id] || hidden.spaceIds.has(space.id)) {
      continue
    }
    const nextRect = byId.get(space.id)?.rect
    if (!nextRect) {
      continue
    }
    const delta = { x: nextRect.x - space.rect.x, y: nextRect.y - space.rect.y }
    if (!delta.x && !delta.y) {
      continue
    }
    for (const nodeId of collectSpaceNodeIds(space.id, spaces)) {
      movedHiddenNodes.set(nodeId, delta)
    }
    for (const descendantId of collectSpaceDescendantIds(space.id, spaces)) {
      if (descendantId !== space.id) {
        movedHiddenSpaces.set(descendantId, delta)
      }
    }
  }
  const nextNodePositionById = new Map(projected.nextNodePositionById)
  for (const node of nodes) {
    const delta = movedHiddenNodes.get(node.id)
    if (delta) {
      nextNodePositionById.set(node.id, {
        x: node.position.x + delta.x,
        y: node.position.y + delta.y,
      })
    } else if (hidden.nodeIds.has(node.id)) {
      // The layout omits hidden runtimes. Still restore their baseline after a
      // previous live preview pushed the compact parent and then moved back.
      nextNodePositionById.set(node.id, node.position)
    }
  }
  const nextSpaces = spaces.map(space => {
    const delta = movedHiddenSpaces.get(space.id)
    if (delta && space.rect) {
      return {
        ...space,
        rect: { ...space.rect, x: space.rect.x + delta.x, y: space.rect.y + delta.y },
      }
    }
    const next = byId.get(space.id) ?? space
    if (state.collapsedSpaceIds[space.id] && space.rect && next.rect) {
      return { ...next, rect: { ...space.rect, x: next.rect.x, y: next.rect.y } }
    }
    return next
  })
  return { ...projected, nextNodePositionById, nextSpaces }
}
