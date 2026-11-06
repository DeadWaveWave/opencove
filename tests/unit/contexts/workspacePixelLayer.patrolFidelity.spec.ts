import { describe, expect, it, vi } from 'vitest'
import { drawWorkingPixels } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/workingRenderer'
import { projectPixelNodes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/model'
import { readPixelTheme } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/renderer'
import { pixelNode } from './workspacePixelLayer.fixtures'

function frame(zoom: number, now = 1000, dpr = 2) {
  const pixels: { x: number; y: number; size: number; alpha: number; color: unknown }[] = []
  const context = {
    globalAlpha: 1,
    fillStyle: '' as unknown,
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect(x: number, y: number, size: number) {
      pixels.push({ x, y, size, alpha: this.globalAlpha, color: this.fillStyle })
    },
  }
  const viewport = { x: 300, y: 200, zoom, width: 3000, height: 2000 }
  const node = { ...pixelNode({ kind: 'agent', status: 'running' }), id: '' }
  const canvas = document.createElement('canvas')
  canvas.style.setProperty('--cove-kind-ai-ink', '#abcdef')
  document.body.append(canvas)
  const theme = readPixelTheme(canvas)
  canvas.remove()
  drawWorkingPixels(
    context as unknown as CanvasRenderingContext2D,
    projectPixelNodes([node], new Map(), viewport),
    viewport,
    theme,
    now,
    dpr,
  )
  return pixels
}

describe('Tide patrol screen metrics', () => {
  it.each([0.3, 1, 2])('keeps two eight-pixel trains at zoom %s', zoom => {
    const pixels = frame(zoom)
    expect(pixels).toHaveLength(16)
    for (let i = 0; i < 16; i++) {
      expect(pixels[i].size).toBe(i % 8 === 0 ? 3.5 : 2.5)
      expect(pixels[i].alpha).toBe(1 - (i % 8) / 8)
      expect(pixels[i].color).toBe('#abcdef')
      expect(pixels[i].x * 2).toBe(Math.round(pixels[i].x * 2))
      expect(pixels[i].y * 2).toBe(Math.round(pixels[i].y * 2))
    }
    // At t=1s the first three pixels are on the top edge, even at zoom 0.3.
    const center = (i: number) => pixels[i].x + pixels[i].size / 2
    expect(center(0) - center(1)).toBe(11)
    expect(center(1) - center(2)).toBe(11)
    expect(pixels[0].y + pixels[0].size / 2).toBeCloseTo(200 + 80 * zoom - 6, 0)
  })

  it.each([0.3, 2])('travels 240 world px per second at zoom %s', zoom => {
    const a = frame(zoom, 500)[0]
    const b = frame(zoom, 1000)[0]
    expect((b.x - a.x) / zoom).toBeCloseTo(120, 0)
  })

  it.each([0.3, 2])('repeats on the prototype expanded path at zoom %s', zoom => {
    const lapMs = ((2 * (300 + 200) + 48 / zoom) / 240) * 1000
    expect(frame(zoom, 1000 + lapMs)).toEqual(frame(zoom, 1000))
  })

  it('reads each kind ink and falls back for Pixel themes without generated roles', () => {
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const families = ['ai', 'shell', 'plan', 'knowledge', 'media', 'neutral'] as const
    for (const [i, family] of families.entries()) {
      canvas.style.setProperty(`--cove-kind-${family}-ink`, `rgb(${i}, 20, 30)`)
    }
    expect(readPixelTheme(canvas).ink).toEqual(
      Object.fromEntries(families.map((f, i) => [f, `rgb(${i}, 20, 30)`])),
    )
    const pixel = document.createElement('canvas')
    pixel.style.setProperty('--cove-pixel-blue', '#123456')
    pixel.style.setProperty('--cove-pixel-cyan', '#234567')
    pixel.style.setProperty('--cove-pixel-mint', '#345678')
    document.body.append(pixel)
    pixel.style.color = 'rgb(90, 90, 90)'
    expect(readPixelTheme(pixel).ink).toEqual({
      ai: '#123456',
      shell: '#234567',
      plan: '#345678',
      knowledge: '#123456',
      media: '#234567',
      neutral: 'rgb(90, 90, 90)',
    })
    canvas.remove()
    pixel.remove()
  })
})
