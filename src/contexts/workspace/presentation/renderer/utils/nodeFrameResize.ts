import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { NodeFrame, Point, Size } from '../types'

export const NODE_DRAG_HANDLE_SELECTOR = '[data-node-drag-handle=true]'

export type ResizeEdge = 'top' | 'right' | 'bottom' | 'left'
export type ResizeEdges = Partial<Record<ResizeEdge, true>>

interface ResizeStartState {
  client: Point
  frame: NodeFrame
  edges: ResizeEdges
}

export function resolveResizedNodeFrame({
  initialFrame,
  edges,
  delta,
  minSize,
}: {
  initialFrame: NodeFrame
  edges: ResizeEdges
  delta: Point
  minSize: Size
}): NodeFrame {
  let nextX = initialFrame.position.x
  let nextY = initialFrame.position.y
  let nextWidth = initialFrame.size.width
  let nextHeight = initialFrame.size.height

  if (edges.right) {
    nextWidth = initialFrame.size.width + delta.x
  }

  if (edges.left) {
    nextX = initialFrame.position.x + delta.x
    nextWidth = initialFrame.size.width - delta.x
  }

  if (edges.bottom) {
    nextHeight = initialFrame.size.height + delta.y
  }

  if (edges.top) {
    nextY = initialFrame.position.y + delta.y
    nextHeight = initialFrame.size.height - delta.y
  }

  if (nextWidth < minSize.width) {
    if (edges.left && !edges.right) {
      nextX = initialFrame.position.x + (initialFrame.size.width - minSize.width)
    }

    nextWidth = minSize.width
  }

  if (nextHeight < minSize.height) {
    if (edges.top && !edges.bottom) {
      nextY = initialFrame.position.y + (initialFrame.size.height - minSize.height)
    }

    nextHeight = minSize.height
  }

  return {
    position: {
      x: Math.round(nextX),
      y: Math.round(nextY),
    },
    size: {
      width: Math.round(nextWidth),
      height: Math.round(nextHeight),
    },
  }
}

export function getNodeResizeCursor(edges: ResizeEdges): string {
  const { left, right, top, bottom } = edges
  if ((left && top) || (right && bottom)) {
    return 'nwse-resize'
  }

  if ((right && top) || (left && bottom)) {
    return 'nesw-resize'
  }

  if (left || right) {
    return 'ew-resize'
  }

  if (top || bottom) {
    return 'ns-resize'
  }

  return 'default'
}

export function useNodeFrameResize({
  position,
  width,
  height,
  minSize,
  onResize,
  onResizeStart,
  onResizeEnd,
}: {
  position: Point
  width: number
  height: number
  minSize: Size
  onResize: (frame: NodeFrame) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
}): {
  draftFrame: NodeFrame | null
  handleResizePointerDown: (edges: ResizeEdges) => (event: ReactPointerEvent<HTMLElement>) => void
} {
  const resizeStartRef = useRef<ResizeStartState | null>(null)
  const draftFrameRef = useRef<NodeFrame | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [draftFrame, setDraftFrame] = useState<NodeFrame | null>(null)

  useEffect(() => {
    draftFrameRef.current = draftFrame
  }, [draftFrame])

  useEffect(() => {
    if (!draftFrame || isResizing) {
      return
    }

    if (
      draftFrame.position.x === position.x &&
      draftFrame.position.y === position.y &&
      draftFrame.size.width === width &&
      draftFrame.size.height === height
    ) {
      setDraftFrame(null)
    }
  }, [draftFrame, height, isResizing, position.x, position.y, width])

  const handleResizePointerDown = useCallback(
    (edges: ResizeEdges) => (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)

      const frame: NodeFrame = {
        position: { ...position },
        size: { width, height },
      }

      resizeStartRef.current = {
        client: {
          x: event.clientX,
          y: event.clientY,
        },
        frame,
        edges,
      }

      onResizeStart?.()
      setDraftFrame(frame)
      setIsResizing(true)
    },
    [height, onResizeStart, position, width],
  )

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) {
        return
      }

      setDraftFrame(
        resolveResizedNodeFrame({
          initialFrame: start.frame,
          edges: start.edges,
          delta: {
            x: event.clientX - start.client.x,
            y: event.clientY - start.client.y,
          },
          minSize,
        }),
      )
    }

    const finalizeResize = () => {
      setIsResizing(false)

      const finalFrame =
        draftFrameRef.current ??
        ({
          position: { ...position },
          size: { width, height },
        } satisfies NodeFrame)

      onResize(finalFrame)
      resizeStartRef.current = null
      onResizeEnd?.()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finalizeResize, { once: true })
    window.addEventListener('pointercancel', finalizeResize, { once: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finalizeResize)
      window.removeEventListener('pointercancel', finalizeResize)
    }
  }, [height, isResizing, minSize, onResize, onResizeEnd, position, width])

  return {
    draftFrame,
    handleResizePointerDown,
  }
}
