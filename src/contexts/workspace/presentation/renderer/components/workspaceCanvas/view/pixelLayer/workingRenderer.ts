import { pixelNoise, type PixelNode, type PixelViewport } from './model'
import type { PixelTheme } from './renderer'

/** Decorative projection of authoritative Working status, never a PTY activity heuristic.
 * Screen-space sampling bounds work even for very tall or heavily zoomed windows.
 * The shared background canvas keeps pixels behind other windows and out of hit testing.
 */
export function drawWorkingPixels(
  context: CanvasRenderingContext2D,
  nodes: PixelNode[],
  viewport: PixelViewport,
  theme: Pick<PixelTheme, 'blue' | 'cyan' | 'mint'>,
  now: number,
): boolean {
  let active = false
  const scale = Math.min(1, Math.max(0.4, viewport.zoom))
  const gap = 9 * scale
  for (const node of nodes) {
    if (node.tone !== 'working') {
      continue
    }
    const { x, y, width, height } = node.rect
    const start = Math.max(10 * scale, Math.min(40 * viewport.zoom, height * 0.2))
    const end = height - 8 * scale
    const firstRow = Math.max(0, Math.ceil((-y - start - 4) / gap))
    const lastRow = Math.floor((Math.min(end, viewport.height - y + 4) - start) / gap)
    const gradient = context.createLinearGradient(x, y, x + width, y + height)
    gradient.addColorStop(0, theme.blue)
    gradient.addColorStop(0.5, theme.cyan)
    gradient.addColorStop(1, theme.mint)
    context.fillStyle = gradient
    const seed = [...node.id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) | 0, 0)
    for (let edge = 0; edge < 2; edge++) {
      const edgeX = edge ? x + width + 5 * scale : x - 8 * scale
      if (edgeX < -4 || edgeX > viewport.width) {
        continue
      }
      for (let row = firstRow; row <= lastRow; row++) {
        const offset = start + row * gap
        const noise = pixelNoise(row + edge * 997, seed)
        const wave = 0.5 + 0.5 * Math.sin((offset / scale) * 0.036 - now * 0.0018 + edge * 2)
        const fade = Math.min(1, (offset - start + gap) / (gap * 3), (end - offset) / (gap * 3))
        const size = (2 + noise * 2) * scale
        context.globalAlpha = (0.08 + wave * wave * 0.62) * Math.max(0, fade) * scale
        context.fillRect(edgeX, y + offset, size, size)
        active = true
      }
    }
  }
  context.globalAlpha = 1
  return active
}
