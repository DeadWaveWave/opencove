import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GLASS_GRAIN_SIZE,
  glassGrainAlpha,
  glassGrainPixels,
  installGlassGrain,
} from '../../../src/app/renderer/bootstrap/installGlassGrain'

describe('glass grain', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('style')
  })

  it('uses the prototype alpha on dark glass and one step under it on light', () => {
    expect(glassGrainAlpha('dark')).toBe(11)
    expect(glassGrainAlpha('light')).toBe(7)
  })

  it('is uniform grey noise at one alpha, the same on every launch', () => {
    const pixels = glassGrainPixels(11)
    expect(pixels).toHaveLength(GLASS_GRAIN_SIZE * GLASS_GRAIN_SIZE * 4)
    const greys = new Set<number>()
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i + 1]).toBe(pixels[i])
      expect(pixels[i + 2]).toBe(pixels[i])
      expect(pixels[i + 3]).toBe(11)
      greys.add(pixels[i]!)
    }
    // Every grey from black to white turns up across 32 400 pixels.
    expect(greys.size).toBe(256)
    expect(glassGrainPixels(11)).toEqual(pixels)
  })

  it('publishes one grain per appearance on the root, for the generated themes to pick', () => {
    const drawn: Uint8ClampedArray[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return {
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: (image: { data: Uint8ClampedArray }) => drawn.push(image.data),
      } as unknown as CanvasRenderingContext2D
    } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAEC')
    let next = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:grain-${(next += 1)}`)

    installGlassGrain()

    const style = document.documentElement.style
    expect(style.getPropertyValue('--cove-glass-grain-dark')).toBe('url("blob:grain-1")')
    expect(style.getPropertyValue('--cove-glass-grain-light')).toBe('url("blob:grain-2")')
    expect(drawn.map(data => data[3])).toEqual([11, 7])
  })

  it('leaves the grain unset where there is no 2D canvas, so glass falls back to none', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    installGlassGrain()
    expect(document.documentElement.style.getPropertyValue('--cove-glass-grain-dark')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--cove-glass-grain-light')).toBe('')
  })
})
