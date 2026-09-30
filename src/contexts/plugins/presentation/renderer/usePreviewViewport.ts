import { useLayoutEffect, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'

/** Fit the sample coordinate plane, without zoom gestures leaking into settings. */
export function usePreviewViewport(
  size: { width: number; height: number },
  compactSize: { width: number; height: number },
) {
  const { width: fullWidth, height: fullHeight } = size
  const { width: compactWidth, height: compactHeight } = compactSize
  const containerRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ viewport: Viewport; compact: boolean }>({
    viewport: { x: 0, y: 0, zoom: 1 },
    compact: false,
  })
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const fit = () => {
      const { width, height } = container.getBoundingClientRect()
      if (width <= 0 || height <= 0) {
        return
      }
      const compact = width < 440
      const planeWidth = compact ? compactWidth : fullWidth
      const planeHeight = compact ? compactHeight : fullHeight
      const zoom = Math.min(1, width / planeWidth, height / planeHeight)
      setLayout(previous => {
        const next = {
          x: (width - planeWidth * zoom) / 2,
          y: (height - planeHeight * zoom) / 2,
          zoom,
        }
        return previous.compact === compact &&
          previous.viewport.x === next.x &&
          previous.viewport.y === next.y &&
          previous.viewport.zoom === next.zoom
          ? previous
          : { viewport: next, compact }
      })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [fullHeight, fullWidth, compactHeight, compactWidth])
  return { containerRef, ...layout }
}
