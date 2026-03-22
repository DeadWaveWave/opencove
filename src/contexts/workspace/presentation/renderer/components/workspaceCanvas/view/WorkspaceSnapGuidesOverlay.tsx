import React from 'react'
import { useStore } from '@xyflow/react'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'

function useViewportTransform(): { x: number; y: number; zoom: number } {
  return useStore(storeState => {
    const state = storeState as unknown as { transform?: [number, number, number] }
    const transform = state.transform ?? [0, 0, 1]
    const [x, y, zoom] = transform
    return { x, y, zoom }
  })
}

export function WorkspaceSnapGuidesOverlay({
  guides,
}: {
  guides: WorkspaceSnapGuide[] | null
}): React.JSX.Element | null {
  const transform = useViewportTransform()

  if (!guides || guides.length === 0) {
    return null
  }

  return (
    <div className="workspace-snap-guides" data-testid="workspace-snap-guides" aria-hidden="true">
      {guides.map(guide => {
        if (guide.kind === 'v') {
          const top = Math.min(guide.y1, guide.y2) * transform.zoom + transform.y
          const height = Math.abs(guide.y2 - guide.y1) * transform.zoom
          const left = guide.x * transform.zoom + transform.x

          return (
            <div
              key={`v-${guide.x}-${guide.y1}-${guide.y2}`}
              className="workspace-snap-guide workspace-snap-guide--v"
              data-testid="workspace-snap-guide-v"
              style={{ top, left, height }}
            />
          )
        }

        const left = Math.min(guide.x1, guide.x2) * transform.zoom + transform.x
        const width = Math.abs(guide.x2 - guide.x1) * transform.zoom
        const top = guide.y * transform.zoom + transform.y

        return (
          <div
            key={`h-${guide.y}-${guide.x1}-${guide.x2}`}
            className="workspace-snap-guide workspace-snap-guide--h"
            data-testid="workspace-snap-guide-h"
            style={{ top, left, width }}
          />
        )
      })}
    </div>
  )
}
