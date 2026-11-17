import React, { useMemo, type CSSProperties } from 'react'
import type { CanvasInteractionState } from '../../../store/canvasStore.interaction'
import { useCanvasInteraction } from '../../../store/canvasStoreContext'

interface WorkspaceSelectionDraftOverlayProps {
  canvasRef: React.RefObject<HTMLDivElement | null>
}

const selectSelectionDraft = (interaction: CanvasInteractionState) => interaction.selectionDraft

// A leaf subscriber of the `interaction` slice (Decision 2 of #738): a marquee frame renders this
// component and nothing above it.
export function WorkspaceSelectionDraftOverlay({
  canvasRef,
}: WorkspaceSelectionDraftOverlayProps): React.JSX.Element | null {
  const draft = useCanvasInteraction(selectSelectionDraft)
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
