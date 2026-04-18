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
  const pixelSnapFrame1Ref = useRef<number | null>(null)
  const pixelSnapFrame2Ref = useRef<number | null>(null)

  const cancelWebglPixelSnapping = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (pixelSnapFrame1Ref.current !== null) {
      window.cancelAnimationFrame(pixelSnapFrame1Ref.current)
      pixelSnapFrame1Ref.current = null
    }
    if (pixelSnapFrame2Ref.current !== null) {
      window.cancelAnimationFrame(pixelSnapFrame2Ref.current)
      pixelSnapFrame2Ref.current = null
    }
  }, [])

  const scheduleWebglPixelSnapping = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (pixelSnapFrame1Ref.current !== null || pixelSnapFrame2Ref.current !== null) {
      return
    }

    // Use double-rAF to ensure layout has settled before applying pixel snapping.
    pixelSnapFrame1Ref.current = window.requestAnimationFrame(() => {
      pixelSnapFrame2Ref.current = window.requestAnimationFrame(() => {
        pixelSnapFrame1Ref.current = null
        pixelSnapFrame2Ref.current = null
        applyWebglPixelSnapping({
          container: containerRef.current,
          rendererKind: activeRendererKindRef.current,
        })
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
