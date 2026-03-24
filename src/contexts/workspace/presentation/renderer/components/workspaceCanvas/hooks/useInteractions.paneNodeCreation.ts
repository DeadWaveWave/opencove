import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { StandardWindowSizeBucket } from '@contexts/settings/domain/agentSettings'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState, CreateNodeInput } from '../types'
import { resolveDefaultNoteWindowSize, resolveDefaultTerminalWindowSize } from '../constants'
import { resolveNodePlacementAnchorFromViewportCenter } from '../helpers'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'
import { createNoteNodeAtAnchor } from './useInteractions.noteCreation'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export async function createTerminalNodeAtFlowPosition({
  anchor,
  defaultTerminalProfileId,
  standardWindowSizeBucket,
  workspacePath,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  createNodeForSession,
}: {
  anchor: Point
  defaultTerminalProfileId: string | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  workspacePath: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
}): Promise<void> {
  const cursorAnchor = {
    x: anchor.x,
    y: anchor.y,
  }
  const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
    cursorAnchor,
    resolveDefaultTerminalWindowSize(standardWindowSizeBucket),
  )

  const targetSpace = findContainingSpaceByAnchor(spacesRef.current, cursorAnchor)

  const resolvedCwd =
    targetSpace && targetSpace.directoryPath.trim().length > 0
      ? targetSpace.directoryPath
      : workspacePath

  const spawned = await window.opencoveApi.pty.spawn({
    cwd: resolvedCwd,
    profileId: defaultTerminalProfileId ?? undefined,
    cols: 80,
    rows: 24,
  })

  const created = await createNodeForSession({
    sessionId: spawned.sessionId,
    profileId: spawned.profileId,
    runtimeKind: spawned.runtimeKind,
    title: `terminal-${nodesRef.current.length + 1}`,
    anchor: nodeAnchor,
    kind: 'terminal',
    executionDirectory: resolvedCwd,
    expectedDirectory: resolvedCwd,
    placement: {
      targetSpaceRect: targetSpace?.rect ?? null,
    },
  })

  if (!created || !targetSpace) {
    return
  }

  assignNodeToSpaceAndExpand({
    createdNodeId: created.id,
    targetSpaceId: targetSpace.id,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}

export function createNoteNodeAtFlowPosition({
  anchor,
  standardWindowSizeBucket,
  createNoteNode,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  anchor: Point
  standardWindowSizeBucket: StandardWindowSizeBucket
  createNoteNode: (anchor: Point) => Node<TerminalNodeData> | null
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): void {
  const cursorAnchor = {
    x: anchor.x,
    y: anchor.y,
  }
  const nodeAnchor = resolveNodePlacementAnchorFromViewportCenter(
    cursorAnchor,
    resolveDefaultNoteWindowSize(standardWindowSizeBucket),
  )

  createNoteNodeAtAnchor({
    anchor: nodeAnchor,
    spaceAnchor: cursorAnchor,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}

export async function createTerminalNodeFromPaneContextMenu({
  contextMenu,
  defaultTerminalProfileId,
  workspacePath,
  spacesRef,
  nodesRef,
  standardWindowSizeBucket,
  setNodes,
  onSpacesChange,
  createNodeForSession,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  defaultTerminalProfileId: string | null
  workspacePath: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  standardWindowSizeBucket: StandardWindowSizeBucket
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setContextMenu: (next: ContextMenuState | null) => void
}): Promise<void> {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }

  setContextMenu(null)
  await createTerminalNodeAtFlowPosition({
    anchor: {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    },
    defaultTerminalProfileId,
    standardWindowSizeBucket,
    workspacePath,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
    createNodeForSession,
  })
}

export function createNoteNodeFromPaneContextMenu({
  contextMenu,
  createNoteNode,
  standardWindowSizeBucket,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  createNoteNode: (anchor: Point) => Node<TerminalNodeData> | null
  standardWindowSizeBucket: StandardWindowSizeBucket
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
  setContextMenu: (next: ContextMenuState | null) => void
}): void {
  if (!contextMenu || contextMenu.kind !== 'pane') {
    return
  }

  setContextMenu(null)
  createNoteNodeAtFlowPosition({
    anchor: {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    },
    standardWindowSizeBucket,
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}
