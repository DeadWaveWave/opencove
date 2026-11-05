import type { Rgb } from '@shared/design/oklch'
import type { WallGlass } from './wallGlass'
import type { WallGrid } from './wallGrid'

/** Everything a renderer needs to paint one frame of the wall. */
export interface WallFrame {
  grid: WallGrid
  /** RGBA per visible cell, row by row. */
  cells: Uint8ClampedArray
  gapColor: Rgb
  /** Windows in view, drawn as frosted glass over the cells. */
  glass: WallGlass
  /** The shell's top bar and sidebar, floating on the wall as square-cornered frosted glass. */
  chrome: WallGlass
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
