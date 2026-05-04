import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react'
import { clearWebglCanvasTransform } from './webglCanvasTransformCleanup'

export type TerminalRendererKind = 'webgl' | 'dom'

export function useWebglCanvasTransformCleanupScheduler(input: {
  containerRef: RefObject<HTMLElement | null>
}): {
  activeRendererKindRef: MutableRefObject<TerminalRendererKind>
  scheduleWebglCanvasTransformCleanup: () => void
  cancelWebglCanvasTransformCleanup: () => void
  setRendererKindAndApply: (kind: TerminalRendererKind) => void
} {
  const { containerRef } = input
  const activeRendererKindRef = useRef<TerminalRendererKind>('dom')
  const cleanupFrame1Ref = useRef<number | null>(null)
  const cleanupFrame2Ref = useRef<number | null>(null)

  const cancelWebglCanvasTransformCleanup = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (cleanupFrame1Ref.current !== null) {
      window.cancelAnimationFrame(cleanupFrame1Ref.current)
      cleanupFrame1Ref.current = null
    }
    if (cleanupFrame2Ref.current !== null) {
      window.cancelAnimationFrame(cleanupFrame2Ref.current)
      cleanupFrame2Ref.current = null
    }
  }, [])

  const scheduleWebglCanvasTransformCleanup = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (cleanupFrame1Ref.current !== null || cleanupFrame2Ref.current !== null) {
      return
    }

    cleanupFrame1Ref.current = window.requestAnimationFrame(() => {
      cleanupFrame2Ref.current = window.requestAnimationFrame(() => {
        cleanupFrame1Ref.current = null
        cleanupFrame2Ref.current = null
        clearWebglCanvasTransform({
          container: containerRef.current,
          rendererKind: activeRendererKindRef.current,
        })
      })
    })
  }, [containerRef])

  const setRendererKindAndApply = useCallback(
    (kind: TerminalRendererKind) => {
      activeRendererKindRef.current = kind
      clearWebglCanvasTransform({
        container: containerRef.current,
        rendererKind: kind,
      })
    },
    [containerRef],
  )

  return {
    activeRendererKindRef,
    scheduleWebglCanvasTransformCleanup,
    cancelWebglCanvasTransformCleanup,
    setRendererKindAndApply,
  }
}
