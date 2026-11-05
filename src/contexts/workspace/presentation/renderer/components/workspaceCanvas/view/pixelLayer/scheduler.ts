/** Decorative frame rates (Tide phase 5.1): hidden pages paint nothing at all. */
export const PIXEL_FRAME_RATE = { focused: 30, unfocused: 10 } as const

/** Display frames arrive with a little jitter; paint a frame this early rather than one late. */
const VSYNC_TOLERANCE_MS = 0.5

/**
 * One owner for decorative frames. It never schedules terminal output or layout work.
 *
 * Throttling accumulates the time between display frames and paints once a frame's worth has
 * passed, carrying the remainder. Skipping frames that arrive "too early" instead quantises: on a
 * 120Hz display a 30fps cap becomes 24fps. A stall paints once and does not burst afterwards.
 */
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
  let focused = true
  let disposed = false
  /** Time of the previous display frame while painting continuously; null when idle. */
  let lastFrame: number | null = null
  let accumulated = 0
  let paintNext = true

  const interval = () => 1000 / (focused ? PIXEL_FRAME_RATE.focused : PIXEL_FRAME_RATE.unfocused)

  const invalidate = ({ immediate = false }: { immediate?: boolean } = {}): void => {
    if (disposed || !visible) {
      return
    }
    if (immediate) {
      paintNext = true
    }
    if (frame !== null) {
      return
    }
    frame = requestFrame(now => {
      frame = null
      if (disposed || !visible) {
        return
      }
      const step = interval()
      if (paintNext || lastFrame === null) {
        paintNext = false
        accumulated = step
      } else {
        accumulated += now - lastFrame
      }
      lastFrame = now
      if (accumulated < step - VSYNC_TOLERANCE_MS) {
        invalidate()
        return
      }
      // Carry the part of a frame that arrived late; a frame painted early owes nothing and a
      // stall is forgiven rather than repaid.
      accumulated -= step
      if (accumulated < 0 || accumulated >= step) {
        accumulated = 0
      }
      if (draw(now)) {
        invalidate()
      } else {
        lastFrame = null
      }
    })
  }

  const cancel = (): void => {
    if (frame !== null) {
      cancelFrame(frame)
    }
    frame = null
    lastFrame = null
  }

  return {
    invalidate,
    /** Unfocused windows keep animating, more slowly. */
    setFocused(next: boolean): void {
      focused = next
    },
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
