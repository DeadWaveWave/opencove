import type { Page } from '@playwright/test'

type PixelDraw = { x: number; y: number; size: number; alpha: number; color: string }
export type PixelDrawFrame = { zoom: number; pixels: PixelDraw[]; at: number }
type ProbeWindow = Window & {
  __pixelDrawProbe?: { frames: PixelDrawFrame[]; stop: () => void }
}

/** Retains actual Canvas2D draws, including effects that finish between runner steps. */
export async function installPixelDrawProbe(page: Page) {
  await page.evaluate(() => {
    const target = window as ProbeWindow
    target.__pixelDrawProbe?.stop()
    const prototype = CanvasRenderingContext2D.prototype
    const clear = prototype.clearRect
    const fill = prototype.fillRect
    const frames: PixelDrawFrame[] = []
    let current: PixelDrawFrame | null = null
    const matches = (context: CanvasRenderingContext2D) =>
      context.canvas.dataset.testid === 'workspace-pixel-layer'
    prototype.clearRect = function (...args) {
      if (matches(this)) {
        const viewport = document.querySelector('.react-flow__viewport')
        const zoom = viewport ? new DOMMatrix(getComputedStyle(viewport).transform).a : 1
        current = { zoom, pixels: [], at: performance.now() }
        frames.push(current)
        if (frames.length > 120) {
          frames.shift()
        }
      }
      return clear.apply(this, args)
    }
    prototype.fillRect = function (x, y, width, height) {
      const result = fill.call(this, x, y, width, height)
      if (matches(this) && current && width === height && current.pixels.length < 1200) {
        current.pixels.push({
          x,
          y,
          size: width,
          alpha: this.globalAlpha,
          color: String(this.fillStyle),
        })
      }
      return result
    }
    target.__pixelDrawProbe = {
      frames,
      stop: () => {
        prototype.clearRect = clear
        prototype.fillRect = fill
      },
    }
  })
}

export async function readPixelDrawProbe(page: Page): Promise<PixelDrawFrame[]> {
  return page.evaluate(() => (window as ProbeWindow).__pixelDrawProbe?.frames ?? [])
}
