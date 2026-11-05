import type { WallWindowRect } from './wallCells'
import type { WallGlass } from './wallGlass'

/** What E2E can learn about the wall without reading back a WebGL canvas. */
export interface PixelWallTestApi {
  /** Each window's frame and work light in the last frame. */
  getLights: () => WallWindowRect[]
  /** Windows drawn as frosted glass in the last frame. */
  getGlassCount: () => number
  /** Where that glass went: x, y, width, height on the wall, in CSS px. */
  getGlassRects: () => number[][]
  /** The shell's chrome frosted on the wall (top bar, sidebar), as x, y, width, height. */
  getChromeRects: () => number[][]
  /** Output ripples on the wall in the last frame. */
  getRippleCount: () => number
  /** Who sent each wave in the last frame: a window id, or `sonar:`, `waiting:`, `complete:`… */
  getRippleKeys: () => string[]
  /** Every wave key drawn since the page loaded, so a test cannot miss a one-second wave. */
  getSeenRippleKeys: () => string[]
  getFrameCount: () => number
  /** Frames painted with a clock; a still wall (reduced motion, lost context) adds none. */
  getAnimatedFrameCount: () => number
  /** A checksum of the last painted cells: it changes when the wall visibly changes. */
  getSignature: () => number
  /** Mean colour of the last painted cells. */
  getMeanColor: () => [number, number, number] | null
}

declare global {
  interface Window {
    __opencovePixelWallTestApi?: PixelWallTestApi
  }
}

let frames = 0
let animatedFrames = 0
let lastCells: Uint8ClampedArray | null = null
let lastLights: readonly WallWindowRect[] = []
let lastGlassCount = 0
let lastGlass: WallGlass | null = null
let lastChrome: WallGlass | null = null
let lastRippleCount = 0
let lastRippleKeys: readonly string[] = []
const seenRippleKeys = new Set<string>()

function unpackRects(glass: WallGlass | null): number[][] {
  return Array.from({ length: glass?.count ?? 0 }, (_, index) =>
    Array.from(glass!.rects.subarray(index * 4, index * 4 + 4)),
  )
}

/** Counts a frame; the checksum is only computed when a test asks for it. */
export function recordWallFrame(
  cells: Uint8ClampedArray,
  {
    animated,
    lights = [],
    glassCount = 0,
    glass = null,
    chrome = null,
    rippleCount = 0,
    rippleKeys = [],
  }: {
    animated: boolean
    lights?: readonly WallWindowRect[]
    glassCount?: number
    glass?: WallGlass | null
    chrome?: WallGlass | null
    rippleCount?: number
    rippleKeys?: readonly string[]
  },
): void {
  frames++
  if (animated) {
    animatedFrames++
  }
  lastCells = cells
  lastLights = lights
  lastGlassCount = glassCount
  lastGlass = glass
  lastChrome = chrome
  lastRippleCount = rippleCount
  lastRippleKeys = rippleKeys
  for (const key of rippleKeys) {
    seenRippleKeys.add(key)
  }
  if (typeof window === 'undefined' || window.__opencovePixelWallTestApi) {
    return
  }
  window.__opencovePixelWallTestApi = {
    getLights: () => lastLights.map(light => ({ ...light })),
    getGlassCount: () => lastGlassCount,
    getGlassRects: () => unpackRects(lastGlass),
    getChromeRects: () => unpackRects(lastChrome),
    getRippleCount: () => lastRippleCount,
    getRippleKeys: () => [...lastRippleKeys],
    getSeenRippleKeys: () => [...seenRippleKeys],
    getFrameCount: () => frames,
    getAnimatedFrameCount: () => animatedFrames,
    getSignature: () => {
      let hash = 2166136261
      for (const value of lastCells ?? []) {
        hash = Math.imul(hash ^ value, 16777619)
      }
      return hash >>> 0
    },
    getMeanColor: () => {
      if (!lastCells || lastCells.length === 0) {
        return null
      }
      const sum = [0, 0, 0]
      for (let index = 0; index < lastCells.length; index += 4) {
        sum[0] += lastCells[index]!
        sum[1] += lastCells[index + 1]!
        sum[2] += lastCells[index + 2]!
      }
      const count = lastCells.length / 4
      return [sum[0]! / count, sum[1]! / count, sum[2]! / count]
    },
  }
}
