import type { Rgb } from '@shared/design/oklch'

export const RIPPLE_DURATION_MS = 1100
export const RIPPLE_WINDOW_INTERVAL_MS = 700
export const RIPPLE_LIMIT = 24
export const SONAR_INTERVAL_MS = 2400
export const BEACON_INTERVAL_MS = 1300

/** Tide prototype RIPPLE (1539–1546); drawField (1948) uses the same 1.5 decay for all types. */
export const RIPPLE_SHAPES = {
  output: { durationMs: 1100, reach: 240, width: 30, amp: 0.85 },
  sonar: { durationMs: 1600, reach: 200, width: 44, amp: 0.45 },
  beacon: { durationMs: 1300, reach: 150, width: 28, amp: 0.9 },
  complete: { durationMs: 2100, reach: 860, width: 56, amp: 1 },
  crest: { durationMs: 2100, reach: 900, width: 22, amp: 0.95 },
  fail: { durationMs: 820, reach: 190, width: 26, amp: 0.95 },
} as const
export type RippleType = keyof typeof RIPPLE_SHAPES

export interface Ripple {
  key?: string
  glint?: string
  sourceId?: string
  x: number
  y: number
  radius: number
  /** Gaussian width, in world px. */
  band: number
  strength: number
  color: Rgb
  crest?: boolean
  sweep?: boolean
}

export interface WaveOptions {
  type?: RippleType
  initialRadius?: number
  glint?: string
  sourceId?: string
  minIntervalMs?: number
}

export function rippleRadius(rect: { width: number; height: number }): number {
  return 0.35 * Math.min(rect.width, rect.height)
}

/** Runtime signal waves, bounded by count and lifetime; overflow drops the oldest wave. */
export function createRippleField() {
  const ripples: Array<{
    key: string
    x: number
    y: number
    color: Rgb
    startedAt: number
    type: RippleType
    initialRadius: number
    glint?: string
    sourceId?: string
  }> = []
  const lastByWindow = new Map<string, number>()
  const prune = (now: number) => {
    for (let index = ripples.length - 1; index >= 0; index--) {
      const ripple = ripples[index]!
      if (now - ripple.startedAt >= RIPPLE_SHAPES[ripple.type].durationMs) {
        ripples.splice(index, 1)
      }
    }
    for (const [key, at] of lastByWindow) {
      if (now - at > SONAR_INTERVAL_MS) {
        lastByWindow.delete(key)
      }
    }
  }
  return {
    emit(
      windowId: string,
      center: { x: number; y: number },
      color: Rgb,
      now: number,
      options: WaveOptions = {},
    ): boolean {
      prune(now)
      const type = options.type ?? 'output'
      const interval = options.minIntervalMs ?? (type === 'output' ? RIPPLE_WINDOW_INTERVAL_MS : 0)
      const last = lastByWindow.get(windowId)
      if (last !== undefined && now - last < interval) {
        return false
      }
      lastByWindow.set(windowId, now)
      if (ripples.length >= RIPPLE_LIMIT) {
        ripples.shift()
      }
      ripples.push({
        key: windowId,
        ...center,
        color,
        startedAt: now,
        type,
        initialRadius: options.initialRadius ?? 0,
        sourceId: options.sourceId,
        glint: options.glint,
      })
      return true
    },
    ready(windowId: string, now: number, minIntervalMs = RIPPLE_WINDOW_INTERVAL_MS): boolean {
      const last = lastByWindow.get(windowId)
      return last === undefined || now - last >= minIntervalMs
    },
    sample(now: number): Ripple[] {
      prune(now)
      return ripples
        .filter(ripple => now >= ripple.startedAt)
        .map(ripple => {
          const shape = RIPPLE_SHAPES[ripple.type]
          const t = (now - ripple.startedAt) / shape.durationMs
          return {
            key: ripple.key,
            sourceId: ripple.sourceId,
            glint: ripple.glint,
            x: ripple.x,
            y: ripple.y,
            radius: ripple.initialRadius + shape.reach * (1 - (1 - t) ** 2.2),
            band: shape.width,
            strength: shape.amp * (1 - t) ** 1.5,
            color: ripple.color,
            crest: ripple.type === 'crest',
            sweep: ripple.type === 'complete' || ripple.type === 'crest',
          }
        })
    },
    active(now: number): boolean {
      prune(now)
      return ripples.length > 0
    },
    forget(windowId: string): void {
      lastByWindow.delete(windowId)
    },
    clear(): void {
      ripples.length = 0
      lastByWindow.clear()
    },
  }
}

interface RingGrid {
  worldCell: number
  firstColumn: number
  firstRow: number
  columns: number
  rows: number
}

/**
 * Visits only the visible cells whose centres lie in the ripple's band, with a weight that peaks
 * on the wavefront: the cost follows the ring, not the disc or the window count.
 */
export function forEachRingCell(
  grid: RingGrid,
  ripple: Pick<Ripple, 'x' | 'y' | 'radius' | 'band'>,
  visit: (column: number, row: number, weight: number) => void,
): void {
  const width = Math.max(ripple.band, 0.8 * grid.worldCell)
  const extent = 2.5 * width
  const outer = ripple.radius + extent
  const inner = Math.max(0, ripple.radius - extent)
  const cell = grid.worldCell
  const firstRow = Math.max(0, Math.floor((ripple.y - outer) / cell) - grid.firstRow)
  const lastRow = Math.min(grid.rows - 1, Math.ceil((ripple.y + outer) / cell) - grid.firstRow)
  const visitSpan = (row: number, cy: number, from: number, to: number) => {
    const first = Math.max(0, Math.floor(from / cell - 0.5) - grid.firstColumn)
    const last = Math.min(grid.columns - 1, Math.ceil(to / cell - 0.5) - grid.firstColumn)
    for (let column = first; column <= last; column++) {
      const cx = (grid.firstColumn + column + 0.5) * cell
      if (cx < from || cx > to) {
        continue
      }
      const offset = Math.abs(Math.hypot(cx - ripple.x, cy - ripple.y) - ripple.radius)
      if (offset <= extent) {
        visit(column, row, Math.exp(-((offset / width) ** 2)))
      }
    }
  }
  for (let row = firstRow; row <= lastRow; row++) {
    const cy = (grid.firstRow + row + 0.5) * cell
    const dy = Math.abs(cy - ripple.y)
    if (dy > outer) {
      continue
    }
    const outerHalf = Math.sqrt(outer * outer - dy * dy)
    const innerHalf = dy < inner ? Math.sqrt(inner * inner - dy * dy) : 0
    if (innerHalf <= 0) {
      visitSpan(row, cy, ripple.x - outerHalf, ripple.x + outerHalf)
    } else {
      visitSpan(row, cy, ripple.x - outerHalf, ripple.x - innerHalf)
      visitSpan(row, cy, ripple.x + innerHalf, ripple.x + outerHalf)
    }
  }
}
