import { useCallback } from 'react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { Point, TerminalNodeData } from '../../../types'
import type { WorkspaceCanvasActionKind } from '../view/WorkspaceCanvasActionBar'
import { findContainingSpaceByAnchor } from './useInteractions.spaceAssignment'
import { useCanvasUiCommands, useReadCanvasDocument } from '../../../store/canvasStoreContext'

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
}): {
  createNodeAtViewportCenter: (kind: WorkspaceCanvasActionKind) => void | Promise<void>
  createNodeAtPoint: (kind: WorkspaceCanvasActionKind, point: Point) => void | Promise<void>
  resolveDropTargetLabel: (point: Point) => string | null
} {
  const readDocument = useReadCanvasDocument()

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
      return findContainingSpaceByAnchor(readDocument().spaces, anchor)?.name ?? null
    },
    [reactFlow, readDocument],
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
}: Omit<Parameters<typeof useWorkspaceCanvasActionBarActions>[0], 'clearTransientUi'>) {
  const ui = useCanvasUiCommands()

  const clearTransientUi = useCallback(() => {
    ui.closeContextMenu()
    ui.cancelSpaceRename()
  }, [ui])

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
    }),
    clearActionBarTransientUi: clearTransientUi,
  }
}
