import type { Node } from '@xyflow/react'
import type {
  SpaceArchiveRecord,
  TerminalNodeData,
  WorkspaceSpaceState,
  WorkspaceState,
  WorkspaceViewport,
} from '../types'
import { sanitizeWorkspaceSpaces } from '../utils/workspaceSpaces'

/** The canvas content of one workspace. Every other WorkspaceState field is not document data. */
export interface WorkspaceDocument {
  nodes: Node<TerminalNodeData>[]
  spaces: WorkspaceSpaceState[]
  activeSpaceId: string | null
  spaceArchiveRecords: SpaceArchiveRecord[]
  viewport: WorkspaceViewport
  isMinimapVisible: boolean
}

export function toWorkspaceDocument(workspace: WorkspaceState): WorkspaceDocument {
  return {
    nodes: workspace.nodes,
    spaces: workspace.spaces,
    activeSpaceId: workspace.activeSpaceId,
    spaceArchiveRecords: workspace.spaceArchiveRecords,
    viewport: workspace.viewport,
    isMinimapVisible: workspace.isMinimapVisible,
  }
}

function isSameViewport(left: WorkspaceViewport, right: WorkspaceViewport): boolean {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom
}

/**
 * Returns `workspace` itself when every document field is identical, so the caller can skip the
 * store write. A node or Space change also reconciles Space membership and the active Space in the
 * same result: removed nodes leave their Spaces, Spaces are sanitized, and `activeSpaceId` is
 * dropped unless it names a root Space.
 */
export function applyWorkspaceDocument(
  workspace: WorkspaceState,
  next: WorkspaceDocument,
): WorkspaceState {
  const hasNodesChange = next.nodes !== workspace.nodes
  const hasSpacesChange = next.spaces !== workspace.spaces
  const hasViewportChange = !isSameViewport(next.viewport, workspace.viewport)

  if (
    !hasNodesChange &&
    !hasSpacesChange &&
    !hasViewportChange &&
    next.activeSpaceId === workspace.activeSpaceId &&
    next.spaceArchiveRecords === workspace.spaceArchiveRecords &&
    next.isMinimapVisible === workspace.isMinimapVisible
  ) {
    return workspace
  }

  let spaces = next.spaces
  let activeSpaceId = next.activeSpaceId
  if (hasNodesChange || hasSpacesChange) {
    const nodeIds = hasNodesChange ? new Set(next.nodes.map(node => node.id)) : null
    spaces = sanitizeWorkspaceSpaces(
      nodeIds
        ? next.spaces.map(space => ({
            ...space,
            nodeIds: space.nodeIds.filter(nodeId => nodeIds.has(nodeId)),
          }))
        : next.spaces,
    )
    const hasActiveSpace =
      activeSpaceId !== null &&
      spaces.some(space => space.id === activeSpaceId && !space.parentSpaceId)
    activeSpaceId = hasActiveSpace ? activeSpaceId : null
  }

  return {
    ...workspace,
    nodes: next.nodes,
    spaces,
    activeSpaceId,
    spaceArchiveRecords: next.spaceArchiveRecords,
    viewport: hasViewportChange ? next.viewport : workspace.viewport,
    isMinimapVisible: next.isMinimapVisible,
  }
}
