const FRAME_INTERVAL_MS = 1000 / 25

/** One owner for decorative frames. It never schedules terminal output or layout work. */
export function createPixelFrameScheduler({
  draw,
  requestFrame,
  cancelFrame,
}: {
  draw: (now: number) => boolean
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (id: number) => void
}) {
  let frame: number | null = null
  let visible = true
  let disposed = false
  let lastPaint = Number.NEGATIVE_INFINITY

  const invalidate = ({ immediate = false }: { immediate?: boolean } = {}): void => {
    if (disposed || !visible) {
      return
    }
    if (immediate) {
      lastPaint = Number.NEGATIVE_INFINITY
    }
    if (frame !== null) {
      return
    }
    frame = requestFrame(now => {
      frame = null
      if (disposed || !visible) {
        return
      }
      if (now - lastPaint < FRAME_INTERVAL_MS) {
        invalidate()
        return
      }
      lastPaint = now
      if (draw(now)) {
        invalidate()
      }
    })
  }

  const cancel = (): void => {
    if (frame !== null) {
      cancelFrame(frame)
    }
    frame = null
  }

  return {
    invalidate,
    setVisible(next: boolean): void {
      if (disposed || visible === next) {
        return
      }
      visible = next
      if (visible) {
        invalidate()
      } else {
        cancel()
      }
    },
    dispose(): void {
      disposed = true
      cancel()
    },
  }
}
