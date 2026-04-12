import React from 'react'
import type { WorkspaceCanvasQuickPreviewState } from '../types'

export function useWorkspaceCanvasSpaceExplorerQuickPreviewDismiss({
  quickPreview,
  dismissQuickPreview,
}: {
  quickPreview: WorkspaceCanvasQuickPreviewState | null
  dismissQuickPreview: () => void
}): void {
  React.useEffect(() => {
    if (!quickPreview) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) {
        dismissQuickPreview()
        return
      }

      if (event.target.closest('.workspace-space-quick-preview')) {
        return
      }

      if (event.target.closest('.workspace-space-explorer__entry')) {
        return
      }

      dismissQuickPreview()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      dismissQuickPreview()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [dismissQuickPreview, quickPreview])
}
