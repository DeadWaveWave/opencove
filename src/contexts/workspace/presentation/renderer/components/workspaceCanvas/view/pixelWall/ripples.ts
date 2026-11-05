import type { Rgb } from '@shared/design/oklch'

/** A ripple lasts about a second (Tide signals). */
export const RIPPLE_DURATION_MS = 1000
/** Each window starts at most one ripple per 700ms… */
export const RIPPLE_WINDOW_INTERVAL_MS = 700
/** …and the canvas carries at most 24 at once. */
export const RIPPLE_LIMIT = 24
/** How far a ripple travels, in world px. */
const RIPPLE_REACH = 640

export interface Ripple {
  /** Who sent it: a window id, or `complete:` / `fail:` / `waiting:` plus one. */
  key?: string
  /** Centre in world px. */
  x: number
  y: number
  /** Current wavefront radius and half-width of its band, in world px. */
  radius: number
  band: number
  /** 0–1, fading as the ripple travels. */
  strength: number
  color: Rgb
  /** How strongly the wavefront pulls a cell toward its colour; output ripples use the default. */
  gain?: number
  /** A white crest in blank space, never behind glass (the completion shockwave). */
  crest?: boolean
}

export interface WaveOptions {
  reach?: number
  durationMs?: number
  gain?: number
  crest?: boolean
  /** The least time between two waves with this key; output ripples use 700ms. */
  minIntervalMs?: number
}

/**
 * Received output sends a ripple out from the window's centre: a true circle whose wavefront
 * brightens the cells (or dots) it passes. It only means "output arrived", never a tool call,
 * success or completion. Runtime only.
 */
export function createRippleField() {
  const ripples: Array<{
    key: string
    x: number
    y: number
    color: Rgb
    startedAt: number
    reach: number
    durationMs: number
    gain?: number
    crest?: boolean
  }> = []
  const lastByWindow = new Map<string, number>()
  const prune = (now: number) => {
    for (let index = ripples.length - 1; index >= 0; index--) {
      if (now - ripples[index]!.startedAt > ripples[index]!.durationMs) {
        ripples.splice(index, 1)
      }
    }
  }

  return {
    /**
     * Returns whether a wave started; throttled per key and capped overall. Signal waves (a
     * finished run, a failure) pass their own key and shape.
     */
    emit(
      windowId: string,
      center: { x: number; y: number },
      color: Rgb,
      now: number,
      options: WaveOptions = {},
    ): boolean {
      prune(now)
      const last = lastByWindow.get(windowId)
      if (last !== undefined && now - last < (options.minIntervalMs ?? RIPPLE_WINDOW_INTERVAL_MS)) {
        return false
      }
      if (ripples.length >= RIPPLE_LIMIT) {
        return false
      }
      lastByWindow.set(windowId, now)
      ripples.push({
        key: windowId,
        x: center.x,
        y: center.y,
        color,
        startedAt: now,
        reach: options.reach ?? RIPPLE_REACH,
        durationMs: options.durationMs ?? RIPPLE_DURATION_MS,
        ...(options.gain === undefined ? {} : { gain: options.gain }),
        ...(options.crest ? { crest: true } : {}),
      })
      return true
    },
    /** Whether a wave with this key may start now, before paying to build it. */
    ready(windowId: string, now: number, minIntervalMs = RIPPLE_WINDOW_INTERVAL_MS): boolean {
      const last = lastByWindow.get(windowId)
      return (last === undefined || now - last >= minIntervalMs) && ripples.length < RIPPLE_LIMIT
    },
    sample(now: number): Ripple[] {
      prune(now)
      return ripples
        .filter(ripple => now >= ripple.startedAt)
        .map(ripple => {
          const t = (now - ripple.startedAt) / ripple.durationMs
          const eased = 1 - (1 - t) ** 3
          return {
            key: ripple.key,
            x: ripple.x,
            y: ripple.y,
            radius: 24 + (ripple.reach - 24) * eased,
            band: 30 + 18 * t,
            strength: (1 - t) ** 1.5,
            color: ripple.color,
            ...(ripple.gain === undefined ? {} : { gain: ripple.gain }),
            ...(ripple.crest ? { crest: true } : {}),
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
  const outer = ripple.radius + ripple.band
  const inner = Math.max(0, ripple.radius - ripple.band)
  const cell = grid.worldCell
  const firstRow = Math.max(0, Math.floor((ripple.y - outer) / cell) - grid.firstRow)
  const lastRow = Math.min(grid.rows - 1, Math.ceil((ripple.y + outer) / cell) - grid.firstRow)
  const visitSpan = (row: number, cy: number, from: number, to: number) => {
    const first = Math.max(0, Math.floor(from / cell - 0.5) - grid.firstColumn)
    const last = Math.min(grid.columns - 1, Math.ceil(to / cell - 0.5) - grid.firstColumn)
    for (let column = first; column <= last; column++) {
      const cx = (grid.firstColumn + column + 0.5) * cell
      const offset = Math.abs(Math.hypot(cx - ripple.x, cy - ripple.y) - ripple.radius)
      if (offset <= ripple.band) {
        visit(column, row, 1 - offset / ripple.band)
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
