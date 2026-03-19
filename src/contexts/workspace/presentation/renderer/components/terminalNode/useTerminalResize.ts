import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react'
import type { NodeFrame, Point } from '../../types'
import { useNodeFrameResize, type ResizeEdges } from '../../utils/nodeFrameResize'
import { MIN_HEIGHT, MIN_WIDTH } from './constants'

export function useTerminalResize({
  position,
  width,
  height,
  onResize,
  syncTerminalSize,
  scheduleScrollbackPublish,
  isPointerResizingRef,
}: {
  position: Point
  width: number
  height: number
  onResize: (frame: NodeFrame) => void
  syncTerminalSize: () => void
  scheduleScrollbackPublish: (force?: boolean) => void
  isPointerResizingRef: MutableRefObject<boolean>
}): {
  draftFrame: NodeFrame | null
  handleResizePointerDown: (edges: ResizeEdges) => (event: ReactPointerEvent<HTMLElement>) => void
} {
  const { draftFrame, handleResizePointerDown } = useNodeFrameResize({
    position,
    width,
    height,
    minSize: {
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    },
    onResize,
    onResizeStart: () => {
      isPointerResizingRef.current = true
    },
    onResizeEnd: () => {
      isPointerResizingRef.current = false
      requestAnimationFrame(() => {
        syncTerminalSize()
        scheduleScrollbackPublish(true)
      })
    },
  })

  return { draftFrame, handleResizePointerDown }
}
