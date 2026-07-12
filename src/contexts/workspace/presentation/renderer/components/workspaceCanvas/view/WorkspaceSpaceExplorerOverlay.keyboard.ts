import React from 'react'
import type { SpaceExplorerContextMenuState } from './WorkspaceSpaceExplorerOverlay.operations'
import { shouldHandleExplorerKeydown } from './WorkspaceSpaceExplorerOverlay.model'

const COPY_PATH_CHORD_TIMEOUT_MS = 1_500

function hasExplorerFocus(rootRef: React.RefObject<HTMLElement | null>): boolean {
  const root = rootRef.current
  const activeElement = document.activeElement
  return !!root && activeElement instanceof HTMLElement && root.contains(activeElement)
}

export function useWorkspaceSpaceExplorerOverlayKeyboard({
  rootRef,
  contextMenu,
  dismissTransientUi,
  moveSelection,
  collapseSelectionOrFocusParent,
  expandSelectionOrOpen,
  requestDeleteSelection,
  copySelection,
  cutSelection,
  copyPath,
  canUndoMove,
  canRedoMove,
  undoMove,
  redoMove,
  pasteIntoSelectionTarget,
  startRenameSelection,
  focusFilterInput,
  openKeyboardContextMenu,
  onClose,
}: {
  rootRef: React.RefObject<HTMLElement | null>
  contextMenu: SpaceExplorerContextMenuState | null
  dismissTransientUi: () => boolean
  moveSelection: (direction: 'next' | 'previous' | 'first' | 'last') => void
  collapseSelectionOrFocusParent: () => void
  expandSelectionOrOpen: () => void
  requestDeleteSelection: (anchor?: { x: number; y: number }) => void
  copySelection: () => void
  cutSelection: () => void
  copyPath: () => Promise<void>
  canUndoMove: boolean
  canRedoMove: boolean
  undoMove: () => Promise<void>
  redoMove: () => Promise<void>
  pasteIntoSelectionTarget: () => Promise<void>
  startRenameSelection: () => void
  focusFilterInput: () => void
  openKeyboardContextMenu: () => void
  onClose: () => void
}): void {
  const pendingCopyPathChordRef = React.useRef(false)
  const pendingCopyPathChordTimeoutRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const clearPendingCopyPathChord = (): void => {
      pendingCopyPathChordRef.current = false

      if (pendingCopyPathChordTimeoutRef.current !== null) {
        window.clearTimeout(pendingCopyPathChordTimeoutRef.current)
        pendingCopyPathChordTimeoutRef.current = null
      }
    }

    const armCopyPathChord = (): void => {
      clearPendingCopyPathChord()
      pendingCopyPathChordRef.current = true
      pendingCopyPathChordTimeoutRef.current = window.setTimeout(() => {
        clearPendingCopyPathChord()
      }, COPY_PATH_CHORD_TIMEOUT_MS)
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!hasExplorerFocus(rootRef)) {
        clearPendingCopyPathChord()
        return
      }

      if (event.key === 'Escape') {
        clearPendingCopyPathChord()
        event.preventDefault()
        if (!dismissTransientUi()) {
          onClose()
        }
        return
      }

      if (!shouldHandleExplorerKeydown(event)) {
        return
      }

      if (
        pendingCopyPathChordRef.current &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'p'
      ) {
        clearPendingCopyPathChord()
        event.preventDefault()
        void copyPath()
        return
      }

      if (event.shiftKey && event.key === 'F10') {
        clearPendingCopyPathChord()
        event.preventDefault()
        openKeyboardContextMenu()
        return
      }

      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'f' && !event.shiftKey) {
        clearPendingCopyPathChord()
        event.preventDefault()
        focusFilterInput()
        return
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        if (key === 'c') {
          clearPendingCopyPathChord()
          event.preventDefault()
          copySelection()
        } else if (key === 'x') {
          clearPendingCopyPathChord()
          event.preventDefault()
          cutSelection()
        } else if (key === 'v') {
          clearPendingCopyPathChord()
          event.preventDefault()
          void pasteIntoSelectionTarget()
        } else if (key === 'z') {
          clearPendingCopyPathChord()
          event.preventDefault()
          if (event.shiftKey) {
            if (canRedoMove) {
              void redoMove()
            }
          } else if (canUndoMove) {
            void undoMove()
          }
        } else if (key === 'y' && !event.metaKey && canRedoMove) {
          clearPendingCopyPathChord()
          event.preventDefault()
          void redoMove()
        } else if (key === 'k' && !event.shiftKey) {
          event.preventDefault()
          armCopyPathChord()
        } else {
          clearPendingCopyPathChord()
        }
        return
      }

      clearPendingCopyPathChord()

      if (contextMenu) {
        return
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          moveSelection('previous')
          return
        case 'ArrowDown':
          event.preventDefault()
          moveSelection('next')
          return
        case 'Home':
          event.preventDefault()
          moveSelection('first')
          return
        case 'End':
          event.preventDefault()
          moveSelection('last')
          return
        case 'ArrowLeft':
          event.preventDefault()
          collapseSelectionOrFocusParent()
          return
        case 'ArrowRight':
        case 'Enter':
          event.preventDefault()
          expandSelectionOrOpen()
          return
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          requestDeleteSelection()
          return
        case 'F2':
          event.preventDefault()
          startRenameSelection()
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      clearPendingCopyPathChord()
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }
  }, [
    copyPath,
    canRedoMove,
    canUndoMove,
    collapseSelectionOrFocusParent,
    contextMenu,
    copySelection,
    cutSelection,
    dismissTransientUi,
    expandSelectionOrOpen,
    focusFilterInput,
    onClose,
    openKeyboardContextMenu,
    pasteIntoSelectionTarget,
    redoMove,
    requestDeleteSelection,
    rootRef,
    startRenameSelection,
    undoMove,
    moveSelection,
  ])
}
