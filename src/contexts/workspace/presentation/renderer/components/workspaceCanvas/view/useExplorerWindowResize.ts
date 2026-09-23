import { useCallback, useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import type { NodeFrame } from '../../../types'
import { normalizeResizePointerDelta, type ResizeEdges } from '../../../utils/nodeFrameResize'
import {
  resolveExplorerResizedFrame,
  type SpaceExplorerWindowPlacement,
} from './WorkspaceSpaceExplorerOverlay.layout'

export function useExplorerWindowResize({
  placement,
  zoom,
  containerRef,
  onResize,
}: {
  placement: SpaceExplorerWindowPlacement
  zoom: number
  containerRef: RefObject<HTMLElement | null>
  onResize: (frame: NodeFrame) => void
}) {
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  return useCallback(
    (edges: ResizeEdges) => (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      cleanupRef.current?.()
      containerRef.current?.focus({ preventScroll: true })
      const start = { x: event.clientX, y: event.clientY }
      const pointerId = event.pointerId
      const handleMove = (move: globalThis.PointerEvent) => {
        if (move.pointerId !== pointerId) {
          return
        }
        move.preventDefault()
        onResize(
          resolveExplorerResizedFrame(
            placement,
            edges,
            normalizeResizePointerDelta(
              { x: move.clientX - start.x, y: move.clientY - start.y },
              zoom,
            ),
          ),
        )
      }
      const handleEnd = (end: globalThis.PointerEvent) => {
        if (end.pointerId === pointerId) {
          cleanupRef.current?.()
        }
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', handleMove, true)
        window.removeEventListener('pointerup', handleEnd, true)
        window.removeEventListener('pointercancel', handleEnd, true)
        window.removeEventListener('blur', cleanup)
        cleanupRef.current = null
      }
      window.addEventListener('pointermove', handleMove, true)
      window.addEventListener('pointerup', handleEnd, true)
      window.addEventListener('pointercancel', handleEnd, true)
      window.addEventListener('blur', cleanup)
      cleanupRef.current = cleanup
    },
    [containerRef, onResize, placement, zoom],
  )
}
