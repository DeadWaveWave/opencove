import { createWall2d } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wall2d'
import {
  fillWallCells,
  type WallWindowRect,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallCells'
import {
  projectWallGlass,
  readWallGlassRadius,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGlass'
import { packWallChrome } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallChrome'
import { resolveWallGrid } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallGrid'
import { readWallPalette } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

/** The preview has no shell around it. */
const NO_CHROME = packWallChrome([])

/**
 * The pixel wall in the Settings preview: the canvas's cells, clouds, twinkle and glass cap,
 * drawn with Canvas 2D at zoom 1 behind the preview windows. It owns copied geometry only.
 */
export function createPixelWallPreview(canvas: HTMLCanvasElement, scope: HTMLElement) {
  const surface = createWall2d(canvas)
  let palette = readWallPalette(scope)
  let radius = readWallGlassRadius(scope)
  let cells: Uint8ClampedArray | undefined
  let width = 0
  let height = 0
  let windows: WallWindowRect[] = []

  return {
    measure(): void {
      const bounds = scope.getBoundingClientRect()
      width = bounds.width
      height = bounds.height
      windows = [...scope.querySelectorAll<HTMLElement>('[data-cove-part="window"]')].map(node => {
        const rect = node.getBoundingClientRect()
        return {
          x: rect.left - bounds.left,
          y: rect.top - bounds.top,
          width: rect.width,
          height: rect.height,
        }
      })
    },
    refreshTheme(): void {
      palette = readWallPalette(scope)
      radius = readWallGlassRadius(scope)
    },
    /** A clock in ms animates twinkle and drift; null draws the still wall. */
    draw(now: number | null): void {
      const grid = resolveWallGrid({ x: 0, y: 0, zoom: 1, width, height })
      cells = fillWallCells(grid, palette, now === null ? null : now / 1000, cells, windows)
      surface.draw({
        grid,
        cells,
        gapColor: palette.gap,
        glass: projectWallGlass(windows, { x: 0, y: 0, zoom: 1, width, height }, radius),
        chrome: NO_CHROME,
        width,
        height,
        dpr: Math.min(2, window.devicePixelRatio || 1),
      })
    },
    clear(): void {
      surface.clear()
    },
    dispose(): void {
      surface.dispose()
    },
  }
}
