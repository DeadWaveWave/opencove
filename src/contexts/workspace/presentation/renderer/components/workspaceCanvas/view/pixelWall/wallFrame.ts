import type { Rgb } from '@shared/design/oklch'
import type { WallGrid } from './wallGrid'

/** Everything a renderer needs to paint one frame of the wall. */
export interface WallFrame {
  grid: WallGrid
  /** RGBA per visible cell, row by row. */
  cells: Uint8ClampedArray
  gapColor: Rgb
  /** CSS size of the wall and the device pixel ratio it is drawn at. */
  width: number
  height: number
  dpr: number
}

export interface WallSurface {
  draw(frame: WallFrame): void
  dispose(): void
}

export interface WallFallbackSurface extends WallSurface {
  clear(): void
}
