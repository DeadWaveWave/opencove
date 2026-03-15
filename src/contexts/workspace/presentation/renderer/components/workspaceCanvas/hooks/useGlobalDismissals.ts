import { useEffect, type RefObject } from 'react'
import type { ContextMenuState, SpaceActionMenuState } from '../types'

export function useWorkspaceCanvasGlobalDismissals({
  contextMenu,
  spaceActionMenu,
  closeContextMenu,
  canvasRef,
  selectedNodeCount,
  clearNodeSelection,
}: {
  contextMenu: ContextMenuState | null
  spaceActionMenu: SpaceActionMenuState | null
  closeContextMenu: () => void
  canvasRef: RefObject<HTMLDivElement | null>
  selectedNodeCount: number
  clearNodeSelection: () => void
}): void {
  useEffect(() => {
    if (contextMenu === null && spaceActionMenu === null) {
      return
    }

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return
      }

      if (event.target.closest('.workspace-context-menu')) {
        return
      }

      closeContextMenu()
    }

    window.addEventListener('pointerdown', handleWindowPointerDown, true)

    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown, true)
    }
  }, [closeContextMenu, contextMenu, spaceActionMenu])

  useEffect(() => {
    if (selectedNodeCount === 0) {
      return
    }

    const handleWindowClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.workspace-context-menu')) {
        return
      }

      const canvas = canvasRef.current
      if (canvas && !canvas.contains(event.target)) {
        return
      }

      const isEditableTarget =
        event.target.closest('.terminal-node__terminal') ||
        event.target.closest('input, textarea, select, [contenteditable="true"]')

      if (!isEditableTarget) {
        return
      }

      window.setTimeout(() => {
        clearNodeSelection()
      }, 0)
    }

    window.addEventListener('click', handleWindowClick, true)

    return () => {
      window.removeEventListener('click', handleWindowClick, true)
    }
  }, [canvasRef, clearNodeSelection, selectedNodeCount])
}
