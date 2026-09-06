import React from 'react'
import { LoaderCircle } from 'lucide-react'
import type { WorkspaceSpaceRect } from '../../../types'

export function WorkspaceSpaceOperationOverlay({
  spaceId,
  rect,
  label,
}: {
  spaceId: string
  rect: WorkspaceSpaceRect
  label: string
}): React.JSX.Element {
  return (
    <div
      className="workspace-space-region__operation-state nodrag nopan nowheel"
      data-testid={`workspace-space-operation-${spaceId}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      role="status"
      aria-live="polite"
      onPointerDown={event => {
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <span className="workspace-space-region__operation-pill">
        <LoaderCircle aria-hidden="true" />
        <span>{label}</span>
      </span>
    </div>
  )
}
