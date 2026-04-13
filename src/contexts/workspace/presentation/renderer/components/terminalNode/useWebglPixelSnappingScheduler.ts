import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react'
import { applyWebglPixelSnapping } from './webglPixelSnapping'

export type TerminalRendererKind = 'webgl' | 'dom'

export function useWebglPixelSnappingScheduler(input: {
  containerRef: RefObject<HTMLElement | null>
}): {
  activeRendererKindRef: MutableRefObject<TerminalRendererKind>
  scheduleWebglPixelSnapping: () => void
  cancelWebglPixelSnapping: () => void
  setRendererKindAndApply: (kind: TerminalRendererKind) => void
} {
  const { containerRef } = input
  const activeRendererKindRef = useRef<TerminalRendererKind>('dom')
  const pixelSnapFrameRef = useRef<number | null>(null)

  const cancelWebglPixelSnapping = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (pixelSnapFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pixelSnapFrameRef.current)
    pixelSnapFrameRef.current = null
  }, [])

  const scheduleWebglPixelSnapping = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (pixelSnapFrameRef.current !== null) {
      return
    }

    pixelSnapFrameRef.current = window.requestAnimationFrame(() => {
      pixelSnapFrameRef.current = null
      applyWebglPixelSnapping({
        container: containerRef.current,
        rendererKind: activeRendererKindRef.current,
      })
    })
  }, [containerRef])

  const setRendererKindAndApply = useCallback(
    (kind: TerminalRendererKind) => {
      activeRendererKindRef.current = kind
      applyWebglPixelSnapping({
        container: containerRef.current,
        rendererKind: kind,
      })
    },
    [containerRef],
  )

  return {
    activeRendererKindRef,
    scheduleWebglPixelSnapping,
    cancelWebglPixelSnapping,
    setRendererKindAndApply,
  }
}
