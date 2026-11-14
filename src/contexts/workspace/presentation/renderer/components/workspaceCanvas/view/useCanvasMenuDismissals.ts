import { useEffect } from 'react'
import { useCanvasUi, useCanvasUiCommands } from '../../../store/canvasStoreContext'

/** Closes the canvas menus on a left pointer-down outside them. Mounted by the menus' own leaf. */
export function useWorkspaceCanvasMenuDismissals(): void {
  const ui = useCanvasUiCommands()
  const isAnyMenuOpen = useCanvasUi(
    state => state.contextMenu !== null || state.spaceActionMenu !== null,
  )

  useEffect(() => {
    if (!isAnyMenuOpen) {
      return
    }

    const handleWindowPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) {
        return
      }

      if (event.target.closest('.workspace-context-menu')) {
        return
      }

      ui.closeMenus()
    }

    window.addEventListener('pointerdown', handleWindowPointerDown, true)

    return () => {
      window.removeEventListener('pointerdown', handleWindowPointerDown, true)
    }
  }, [isAnyMenuOpen, ui])
}
