/** What E2E can learn about the wall without reading back a WebGL canvas. */
export interface PixelWallTestApi {
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

/** Counts a frame; the checksum is only computed when a test asks for it. */
export function recordWallFrame(cells: Uint8ClampedArray, animated: boolean): void {
  frames++
  if (animated) {
    animatedFrames++
  }
  lastCells = cells
  if (typeof window === 'undefined' || window.__opencovePixelWallTestApi) {
    return
  }
  window.__opencovePixelWallTestApi = {
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
