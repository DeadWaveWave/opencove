import { useEffect, type RefObject } from 'react'
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

export function useWorkspaceCanvasGlobalDismissals({
  canvasRef,
  selectedNodeCount,
  clearNodeSelection,
}: {
  canvasRef: RefObject<HTMLDivElement | null>
  selectedNodeCount: number
  clearNodeSelection: () => void
}): void {
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

      const editableDomSelector = 'input, textarea, select, [contenteditable="true"]'
      const focusTarget = event.target.closest(editableDomSelector) as HTMLElement | null

      const terminalBody = event.target.closest('.terminal-node__terminal') as HTMLElement | null

      const isEditableTarget = terminalBody || focusTarget

      if (!isEditableTarget) {
        return
      }

      const focusRingSurface = event.target.closest(
        '.terminal-node, .task-node, .note-node, .image-node, .website-node',
      ) as HTMLElement | null
      const activeElementAtClick =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      const resolveFocusTarget = (): HTMLElement | null => {
        if (focusTarget && focusTarget.isConnected) {
          return focusTarget
        }

        if (terminalBody && terminalBody.isConnected) {
          const terminalTextarea = terminalBody.querySelector('.xterm-helper-textarea')
          return terminalTextarea instanceof HTMLElement ? terminalTextarea : null
        }

        return null
      }

      const shouldRestoreFocus =
        terminalBody !== null ||
        (focusTarget !== null &&
          activeElementAtClick !== null &&
          activeElementAtClick === focusTarget)

      window.setTimeout(() => {
        if (focusRingSurface && focusRingSurface.isConnected) {
          focusRingSurface.setAttribute('data-cove-focus-transition', 'true')
          window.setTimeout(() => {
            if (focusRingSurface.isConnected) {
              focusRingSurface.removeAttribute('data-cove-focus-transition')
            }
          }, 120)
        }

        clearNodeSelection()

        if (!shouldRestoreFocus) {
          return
        }

        const restoreFocusIfNeeded = () => {
          const resolvedFocusTarget = resolveFocusTarget()
          if (!resolvedFocusTarget || !resolvedFocusTarget.isConnected) {
            return
          }

          const activeElement =
            typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null

          const isEditableActiveElement = Boolean(
            activeElement &&
            (activeElement.isContentEditable || activeElement.closest(editableDomSelector)),
          )

          if (isEditableActiveElement) {
            return
          }

          resolvedFocusTarget.focus({ preventScroll: true })
        }

        restoreFocusIfNeeded()
        window.setTimeout(() => {
          restoreFocusIfNeeded()
        }, 0)
      }, 0)
    }

    window.addEventListener('click', handleWindowClick, true)

    return () => {
      window.removeEventListener('click', handleWindowClick, true)
    }
  }, [canvasRef, clearNodeSelection, selectedNodeCount])
}
