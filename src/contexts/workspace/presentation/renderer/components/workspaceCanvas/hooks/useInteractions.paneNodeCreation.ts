import type { MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
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
  defaultTerminalWindowScalePercent,
  workspacePath,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  createNodeForSession,
}: {
  anchor: Point
  defaultTerminalProfileId: string | null
  defaultTerminalWindowScalePercent: number
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
    resolveDefaultTerminalWindowSize(defaultTerminalWindowScalePercent),
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
  createNoteNode,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
}: {
  anchor: Point
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
    resolveDefaultNoteWindowSize(),
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
  defaultTerminalWindowScalePercent,
  workspacePath,
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  createNodeForSession,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  defaultTerminalProfileId: string | null
  defaultTerminalWindowScalePercent: number
  workspacePath: string
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
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
    defaultTerminalWindowScalePercent,
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
  spacesRef,
  nodesRef,
  setNodes,
  onSpacesChange,
  setContextMenu,
}: {
  contextMenu: ContextMenuState | null
  createNoteNode: (anchor: Point) => Node<TerminalNodeData> | null
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
    createNoteNode,
    spacesRef,
    nodesRef,
    setNodes,
    onSpacesChange,
  })
}
