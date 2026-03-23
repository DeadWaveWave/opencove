import React from 'react'
import { useStore } from '@xyflow/react'
import type { WorkspaceSnapGuide } from '../../../utils/workspaceSnap'

function useViewportTransform(): {
  x: number
  y: number
  zoom: number
  width: number
  height: number
} {
  return useStore(storeState => {
    const state = storeState as unknown as {
      transform?: [number, number, number]
      width?: number
      height?: number
    }
    const transform = state.transform ?? [0, 0, 1]
    const [x, y, zoom] = transform
    return {
      x,
      y,
      zoom,
      width: state.width ?? 0,
      height: state.height ?? 0,
    }
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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
          const rawTop = Math.min(guide.y1, guide.y2) * transform.zoom + transform.y
          const rawBottom = Math.max(guide.y1, guide.y2) * transform.zoom + transform.y
          const top = clamp(rawTop, 0, transform.height)
          const bottom = clamp(rawBottom, 0, transform.height)
          const height = bottom - top
          const left = clamp(
            guide.x * transform.zoom + transform.x,
            0,
            Math.max(transform.width - 1, 0),
          )

          if (height <= 0 || transform.width <= 0) {
            return null
          }

          return (
            <div
              key={`v-${guide.x}-${guide.y1}-${guide.y2}`}
              className="workspace-snap-guide workspace-snap-guide--v"
              data-testid="workspace-snap-guide-v"
              style={{ top, left, height }}
            />
          )
        }

        const rawLeft = Math.min(guide.x1, guide.x2) * transform.zoom + transform.x
        const rawRight = Math.max(guide.x1, guide.x2) * transform.zoom + transform.x
        const left = clamp(rawLeft, 0, transform.width)
        const right = clamp(rawRight, 0, transform.width)
        const width = right - left
        const top = clamp(
          guide.y * transform.zoom + transform.y,
          0,
          Math.max(transform.height - 1, 0),
        )

        if (width <= 0 || transform.height <= 0) {
          return null
        }

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
