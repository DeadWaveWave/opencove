import React, { useMemo, type CSSProperties } from 'react'
import type { SelectionDraftState } from '../types'

type SelectionDraftUiState = Pick<
  SelectionDraftState,
  'startX' | 'startY' | 'currentX' | 'currentY' | 'phase'
>

interface WorkspaceSelectionDraftOverlayProps {
  canvasRef: React.RefObject<HTMLDivElement | null>
  draft: SelectionDraftUiState | null
}

export function WorkspaceSelectionDraftOverlay({
  canvasRef,
  draft,
}: WorkspaceSelectionDraftOverlayProps): React.JSX.Element | null {
  const style = useMemo<CSSProperties | null>(() => {
    if (!draft) {
      return null
    }

    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }

    const bounds = canvas.getBoundingClientRect()
    const left = Math.min(draft.startX, draft.currentX) - bounds.left
    const top = Math.min(draft.startY, draft.currentY) - bounds.top
    const width = Math.abs(draft.currentX - draft.startX)
    const height = Math.abs(draft.currentY - draft.startY)

    return {
      left,
      top,
      width,
      height,
    }
  }, [canvasRef, draft])

  if (!draft || !style) {
    return null
  }

  return (
    <div
      className="workspace-selection-draft"
      style={style}
      data-selection-phase={draft.phase}
      aria-hidden="true"
    />
  )
}
