import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasActionKind } from '../view/WorkspaceCanvasActionBar'
import { findContainingSpaceByAnchor } from './useInteractions.spaceAssignment'

export function useWorkspaceCanvasActionBarActions({
  canvasRef,
  reactFlow,
  createAgentAtPoint,
  createTerminalAtPoint,
  createNoteAtPoint,
  createTaskAtPoint,
  createWebsiteAtPoint,
  createSpaceAtPoint,
  createPluginAtPoint,
  clearTransientUi,
  spacesRef,
}: {
  canvasRef: React.RefObject<HTMLDivElement | null>
  reactFlow: ReactFlowInstance<Node<TerminalNodeData>, Edge>
  createAgentAtPoint: (anchor: Point) => void | Promise<void>
  createTerminalAtPoint: (anchor: Point) => void | Promise<void>
  createNoteAtPoint: (anchor: Point) => void | Promise<void>
  createTaskAtPoint: (anchor: Point) => void | Promise<void>
  createWebsiteAtPoint: (anchor: Point) => void | Promise<void>
  createSpaceAtPoint: (anchor: Point) => void | Promise<void>
  createPluginAtPoint: (anchor: Point, pluginId: string) => void | Promise<void>
  clearTransientUi: () => void
  spacesRef: React.MutableRefObject<import('../../../types').WorkspaceSpaceState[]>
}): {
  createNodeAtViewportCenter: (kind: WorkspaceCanvasActionKind) => void | Promise<void>
  createNodeAtPoint: (kind: WorkspaceCanvasActionKind, point: Point) => void | Promise<void>
  resolveDropTargetLabel: (point: Point) => string | null
} {
  const createNodeAtPoint = useCallback(
    (kind: WorkspaceCanvasActionKind, point: Point): void | Promise<void> => {
      clearTransientUi()
      const anchor = reactFlow.screenToFlowPosition(point)
      if (kind === 'agent') {
        return createAgentAtPoint(anchor)
      }
      if (kind === 'terminal') {
        return createTerminalAtPoint(anchor)
      }
      if (kind === 'note') {
        return createNoteAtPoint(anchor)
      }
      if (kind === 'task') {
        return createTaskAtPoint(anchor)
      }
      if (kind === 'website') {
        return createWebsiteAtPoint(anchor)
      }
      if (kind === 'space') {
        return createSpaceAtPoint(anchor)
      }
      return createPluginAtPoint(anchor, kind.slice(7))
    },
    [
      clearTransientUi,
      createAgentAtPoint,
      createNoteAtPoint,
      createSpaceAtPoint,
      createPluginAtPoint,
      createTaskAtPoint,
      createTerminalAtPoint,
      createWebsiteAtPoint,
      reactFlow,
    ],
  )

  const createNodeAtViewportCenter = useCallback(
    (kind: WorkspaceCanvasActionKind): void | Promise<void> => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      return createNodeAtPoint(kind, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
    },
    [canvasRef, createNodeAtPoint],
  )

  const resolveDropTargetLabel = useCallback(
    (point: Point): string | null => {
      const anchor = reactFlow.screenToFlowPosition(point)
      return findContainingSpaceByAnchor(spacesRef.current, anchor)?.name ?? null
    },
    [reactFlow, spacesRef],
  )

  return { createNodeAtViewportCenter, createNodeAtPoint, resolveDropTargetLabel }
}

export function useWorkspaceCanvasActionBar({
  canvasRef,
  reactFlow,
  createAgentAtPoint,
  createTerminalAtPoint,
  createNoteAtPoint,
  createTaskAtPoint,
  createWebsiteAtPoint,
  createSpaceAtPoint,
  createPluginAtPoint,
  setContextMenu,
  setEmptySelectionPrompt,
  cancelSpaceRename,
  spacesRef,
}: Omit<Parameters<typeof useWorkspaceCanvasActionBarActions>[0], 'clearTransientUi'> & {
  setContextMenu: (next: null) => void
  setEmptySelectionPrompt: (next: null) => void
  cancelSpaceRename: () => void
}) {
  const clearTransientUi = useCallback(() => {
    setContextMenu(null)
    setEmptySelectionPrompt(null)
    cancelSpaceRename()
  }, [cancelSpaceRename, setContextMenu, setEmptySelectionPrompt])

  return {
    ...useWorkspaceCanvasActionBarActions({
      canvasRef,
      reactFlow,
      createAgentAtPoint,
      createTerminalAtPoint,
      createNoteAtPoint,
      createTaskAtPoint,
      createWebsiteAtPoint,
      createSpaceAtPoint,
      createPluginAtPoint,
      clearTransientUi,
      spacesRef,
    }),
    clearActionBarTransientUi: clearTransientUi,
  }
}
