import { useCallback, type MutableRefObject } from 'react'
import type { Node } from '@xyflow/react'
import type { Point, TerminalNodeData, WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState, CreateNodeInput } from '../types'
import { resolveDefaultTerminalWindowSize } from '../constants'
import { resolveNodePlacementAnchorFromViewportCenter } from '../helpers'
import {
  assignNodeToSpaceAndExpand,
  findContainingSpaceByAnchor,
} from './useInteractions.spaceAssignment'

type SetNodes = (
  updater: (prevNodes: Node<TerminalNodeData>[]) => Node<TerminalNodeData>[],
  options?: { syncLayout?: boolean },
) => void

export function useWorkspaceCanvasTerminalCreation({
  contextMenu,
  setContextMenu,
  defaultTerminalWindowScalePercent,
  spacesRef,
  workspacePath,
  defaultTerminalProfileId,
  nodesRef,
  createNodeForSession,
  setNodes,
  onSpacesChange,
}: {
  contextMenu: ContextMenuState | null
  setContextMenu: (next: ContextMenuState | null) => void
  defaultTerminalWindowScalePercent: number
  spacesRef: MutableRefObject<WorkspaceSpaceState[]>
  workspacePath: string
  defaultTerminalProfileId: string | null
  nodesRef: MutableRefObject<Node<TerminalNodeData>[]>
  createNodeForSession: (input: CreateNodeInput) => Promise<Node<TerminalNodeData> | null>
  setNodes: SetNodes
  onSpacesChange: (spaces: WorkspaceSpaceState[]) => void
}): () => Promise<void> {
  return useCallback(async () => {
    if (!contextMenu || contextMenu.kind !== 'pane') {
      return
    }

    const cursorAnchor: Point = {
      x: contextMenu.flowX,
      y: contextMenu.flowY,
    }
    const anchor = resolveNodePlacementAnchorFromViewportCenter(
      cursorAnchor,
      resolveDefaultTerminalWindowSize(defaultTerminalWindowScalePercent),
    )

    setContextMenu(null)
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
      anchor,
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
  }, [
    contextMenu,
    createNodeForSession,
    nodesRef,
    onSpacesChange,
    setContextMenu,
    setNodes,
    spacesRef,
    defaultTerminalProfileId,
    defaultTerminalWindowScalePercent,
    workspacePath,
  ])
}
