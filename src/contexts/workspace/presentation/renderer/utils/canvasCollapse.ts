import type { Node } from '@xyflow/react'
import type { Size, TerminalNodeData, WorkspaceSpaceState } from '../types'
import { getCollapsedNodeSize } from '../../../domain/collapsedNodeGeometry'
export { getCollapsedNodeSize }

export type CollapsedIds = Record<string, true>
export interface CanvasCollapseState {
  collapsedNodeIds: CollapsedIds
  /** Legacy storage only; migrated to actual compact windows when a workspace opens. */
  collapsedSpaceIds: CollapsedIds
}

export const EMPTY_CANVAS_COLLAPSE: CanvasCollapseState = {
  collapsedNodeIds: {},
  collapsedSpaceIds: {},
}

export function normalizeCollapsedIds(value: unknown): CollapsedIds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter(([id, collapsed]) => id.length > 0 && collapsed === true),
  )
}

/** Convert the in-memory disclosure map to the durable workspace envelope. */
export function serializeCanvasCollapse(state: CanvasCollapseState): {
  collapsedNodeIds: string[]
  collapsedSpaceIds: string[]
} {
  return {
    collapsedNodeIds: Object.keys(state.collapsedNodeIds),
    collapsedSpaceIds: Object.keys(state.collapsedSpaceIds),
  }
}

/** Normalize a persisted list while rejecting empty/duplicate IDs. */
export function normalizeCollapsedIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .filter((id): id is string => typeof id === 'string')
        .map(id => id.trim())
        .filter(Boolean),
    ),
  ]
}

export function canvasCollapseFromPersistedLists(
  collapsedNodeIds: unknown,
  collapsedSpaceIds: unknown,
): CanvasCollapseState | null {
  const nodeIds = normalizeCollapsedIdList(collapsedNodeIds)
  const spaceIds = normalizeCollapsedIdList(collapsedSpaceIds)
  if (nodeIds.length === 0 && spaceIds.length === 0) {
    return null
  }

  return {
    collapsedNodeIds: Object.fromEntries(nodeIds.map(id => [id, true as const])),
    collapsedSpaceIds: Object.fromEntries(spaceIds.map(id => [id, true as const])),
  }
}

export function normalizeCanvasCollapse(value: unknown): CanvasCollapseState {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    collapsedNodeIds: normalizeCollapsedIds(record.collapsedNodeIds),
    collapsedSpaceIds: normalizeCollapsedIds(record.collapsedSpaceIds),
  }
}

export function setCollapsed(ids: CollapsedIds, id: string, collapsed: boolean): CollapsedIds {
  if (collapsed) {
    return { ...ids, [id]: true }
  }
  const next = { ...ids }
  delete next[id]
  return next
}

export function getNodeDisplaySize(node: Node<TerminalNodeData>, ids: CollapsedIds): Size {
  return ids[node.id] ? getCollapsedNodeSize() : node.data
}

export function getCollapsedSpaceSize(nodeCount: number): Size {
  return { width: 360, height: 92 + Math.max(1, Math.ceil(nodeCount / 6)) * 48 }
}

export function collectSpaceDescendantIds(
  spaceId: string,
  spaces: WorkspaceSpaceState[],
): Set<string> {
  const ids = new Set([spaceId])
  for (let changed = true; changed; ) {
    changed = false
    for (const space of spaces) {
      if (space.parentSpaceId && ids.has(space.parentSpaceId) && !ids.has(space.id)) {
        ids.add(space.id)
        changed = true
      }
    }
  }
  return ids
}

export function collectSpaceNodeIds(spaceId: string, spaces: WorkspaceSpaceState[]): Set<string> {
  const ids = collectSpaceDescendantIds(spaceId, spaces)
  return new Set(spaces.filter(space => ids.has(space.id)).flatMap(space => space.nodeIds))
}

export function migrateLegacySpaceCollapse(
  state: CanvasCollapseState,
  spaces: WorkspaceSpaceState[],
): CanvasCollapseState {
  if (Object.keys(state.collapsedSpaceIds).length === 0) {
    return state
  }
  const collapsedNodeIds = { ...state.collapsedNodeIds }
  for (const spaceId of Object.keys(state.collapsedSpaceIds)) {
    for (const nodeId of collectSpaceNodeIds(spaceId, spaces)) {
      collapsedNodeIds[nodeId] = true
    }
  }
  return { collapsedNodeIds, collapsedSpaceIds: {} }
}

export function getCollapsedSpaceHiddenIds(
  spaces: WorkspaceSpaceState[],
  collapsed: CollapsedIds,
): { nodeIds: Set<string>; spaceIds: Set<string> } {
  const nodeIds = new Set<string>()
  const spaceIds = new Set<string>()
  for (const space of spaces) {
    if (!collapsed[space.id]) {
      continue
    }
    for (const id of collectSpaceNodeIds(space.id, spaces)) {
      nodeIds.add(id)
    }
    for (const id of collectSpaceDescendantIds(space.id, spaces)) {
      if (id !== space.id) {
        spaceIds.add(id)
      }
    }
  }
  return { nodeIds, spaceIds }
}

export function revealCollapsedNode(
  state: CanvasCollapseState,
  nodeId: string,
  spaces: WorkspaceSpaceState[],
): CanvasCollapseState {
  let collapsedSpaceIds = state.collapsedSpaceIds
  for (const space of spaces) {
    if (collapsedSpaceIds[space.id] && collectSpaceNodeIds(space.id, spaces).has(nodeId)) {
      collapsedSpaceIds = setCollapsed(collapsedSpaceIds, space.id, false)
    }
  }
  return {
    collapsedSpaceIds,
    collapsedNodeIds: setCollapsed(state.collapsedNodeIds, nodeId, false),
  }
}

/** Display projection only: data dimensions and mounted runtime identity stay canonical. */
export function projectCollapsedNodes(
  nodes: Node<TerminalNodeData>[],
  spaces: WorkspaceSpaceState[],
  state: CanvasCollapseState,
): Node<TerminalNodeData>[] {
  const hidden = getCollapsedSpaceHiddenIds(spaces, state.collapsedSpaceIds).nodeIds
  return nodes.map(node => {
    const collapsed = state.collapsedNodeIds[node.id] === true
    const spaceHidden = hidden.has(node.id)
    const size = spaceHidden
      ? { width: 0, height: 0 }
      : getNodeDisplaySize(node, state.collapsedNodeIds)
    return {
      ...node,
      // React Flow reads these before ResizeObserver runs after each controlled
      // drag update. Its dimension fallbacks must describe the visible shell,
      // never the expanded runtime retained in data.
      width: size.width,
      height: size.height,
      initialWidth: size.width,
      initialHeight: size.height,
      measured:
        node.measured?.width === size.width && node.measured?.height === size.height
          ? node.measured
          : undefined,
      className: [node.className, spaceHidden ? 'cove-node--space-collapsed' : '']
        .filter(Boolean)
        .join(' '),
      selectable: spaceHidden ? false : node.selectable,
      selected: spaceHidden ? false : node.selected,
      draggable: spaceHidden ? false : node.draggable,
      focusable: spaceHidden ? false : node.focusable,
      style: {
        ...node.style,
        width: size.width,
        height: size.height,
        ...(spaceHidden ? { visibility: 'hidden', pointerEvents: 'none' } : {}),
      },
      data: { ...node.data, collapsePresentation: { collapsed, spaceHidden } },
    }
  })
}
