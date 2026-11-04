import type { WallFallbackSurface, WallFrame } from './wallFrame'

/**
 * The wall on Canvas 2D. The cell colours go into a canvas one pixel per cell, which is scaled
 * up without smoothing, and the seams are drawn as one line per row and column: the cost
 * follows the grid's edges, not its area. Behind each window the same cells are scaled up with
 * smoothing and only faint seams, as frosted glass.
 */
export function createWall2d(canvas: HTMLCanvasElement): WallFallbackSurface {
  const context = canvas.getContext('2d', { alpha: false })
  const source = document.createElement('canvas')
  const sourceContext = source.getContext('2d')
  let image: ImageData | null = null

  return {
    draw(frame: WallFrame): void {
      if (!context || !sourceContext) {
        return
      }
      const { grid } = frame
      const width = Math.round(frame.width * frame.dpr)
      const height = Math.round(frame.height * frame.dpr)
      if (canvas.width !== width) {
        canvas.width = width
      }
      if (canvas.height !== height) {
        canvas.height = height
      }
      canvas.hidden = false
      if (width === 0 || height === 0 || grid.columns === 0 || grid.rows === 0) {
        return
      }
      if (source.width !== grid.columns || source.height !== grid.rows || !image) {
        source.width = grid.columns
        source.height = grid.rows
        image = sourceContext.createImageData(grid.columns, grid.rows)
      }
      image.data.set(frame.cells)
      sourceContext.putImageData(image, 0, 0)
      context.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0)
      context.imageSmoothingEnabled = false
      context.drawImage(
        source,
        grid.originX,
        grid.originY,
        grid.columns * grid.screenCell,
        grid.rows * grid.screenCell,
      )
      const [r, g, b] = frame.gapColor
      context.fillStyle = `rgb(${r} ${g} ${b})`
      const drawSeams = (gap: number) => {
        const half = gap / 2
        for (let column = 0; column <= grid.columns; column++) {
          context.fillRect(grid.originX + column * grid.screenCell - half, 0, gap, frame.height)
        }
        for (let row = 0; row <= grid.rows; row++) {
          context.fillRect(0, grid.originY + row * grid.screenCell - half, frame.width, gap)
        }
      }
      drawSeams(grid.gap)
      const { glass } = frame
      for (let index = 0; index < glass.count; index++) {
        const [left, top, glassWidth, glassHeight] = glass.rects.subarray(index * 4, index * 4 + 4)
        context.save()
        context.beginPath()
        context.roundRect(left!, top!, glassWidth!, glassHeight!, glass.radius)
        context.clip()
        context.imageSmoothingEnabled = true
        context.drawImage(
          source,
          grid.originX,
          grid.originY,
          grid.columns * grid.screenCell,
          grid.rows * grid.screenCell,
        )
        context.globalAlpha = 0.16
        drawSeams(grid.gap * 1.2)
        context.restore()
      }
    },
    clear(): void {
      canvas.hidden = true
      context?.clearRect(0, 0, canvas.width, canvas.height)
    },
    dispose(): void {
      image = null
      source.width = 0
      source.height = 0
    },
  }
}
