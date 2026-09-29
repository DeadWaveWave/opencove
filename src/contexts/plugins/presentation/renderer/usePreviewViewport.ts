import { useLayoutEffect, useRef, useState } from 'react'
import type { Viewport } from '@xyflow/react'

/** Fit the sample coordinate plane, without zoom gestures leaking into settings. */
export function usePreviewViewport(
  size: { width: number; height: number },
  compactSize: { width: number; height: number },
) {
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
      const plane = compact ? compactSize : size
      const zoom = Math.min(1, width / plane.width, height / plane.height)
      setLayout(previous => {
        const next = {
          x: (width - plane.width * zoom) / 2,
          y: (height - plane.height * zoom) / 2,
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
  }, [size.height, size.width, compactSize.height, compactSize.width])
  return { containerRef, ...layout }
}
