import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../../types'
import { resolveAgentPresentation } from '../../../../utils/agentPresentation'
import { resolveWindowKindFamily } from '../../../../utils/windowKindFamily'
import { forEachRingCell, type createRippleField, type Ripple } from '../pixelWall/ripples'
import { readWallLightPalette } from '../pixelWall/wallPalette'
import type { PixelViewport } from './geometry'
import type { PixelNode } from './model'

/** The output ripple's gain, the reference strength for dots. */
const OUTPUT_GAIN = 0.62
/** Every 2.4s a working agent sends a low sonar wave (Tide 5.4b). */
export const SONAR_INTERVAL_MS = 2400
export const SONAR_WAVE = { reach: 360, durationMs: 1200, gain: 0.26 }

/** The neutral dot grid's spacing in world px (React Flow's background dots). */
const DOT_GAP = 24

/**
 * Output ripples on the 「简约」 dot grid: the dots the wavefront passes grow and light up in the
 * window's kind colour. Dots sit on world multiples of the gap, so the ring is computed on cells
 * whose centres are those dots.
 */
export function drawDotRipples(
  context: CanvasRenderingContext2D,
  viewport: PixelViewport,
  ripples: readonly Ripple[],
): number {
  if (viewport.zoom <= 0) {
    return 0
  }
  const gap = DOT_GAP
  const firstColumn = Math.floor(-viewport.x / viewport.zoom / gap) - 1
  const firstRow = Math.floor(-viewport.y / viewport.zoom / gap) - 1
  const grid = {
    worldCell: gap,
    firstColumn,
    firstRow,
    columns: Math.ceil(viewport.width / viewport.zoom / gap) + 3,
    rows: Math.ceil(viewport.height / viewport.zoom / gap) + 3,
  }
  const scale = Math.min(1, 0.4 + viewport.zoom)
  let painted = 0
  for (const ripple of ripples) {
    const [r, g, b] = ripple.color
    context.fillStyle = `rgb(${r} ${g} ${b})`
    // Cell centres are half a gap past the dots; shift the ring so it is centred on dots.
    const centred = { ...ripple, x: ripple.x + gap / 2, y: ripple.y + gap / 2 }
    // A sonar wave is fainter than an output ripple; an output ripple keeps full strength.
    const gain = (ripple.gain ?? OUTPUT_GAIN) / OUTPUT_GAIN
    forEachRingCell(grid, centred, (column, row, weight) => {
      const strength = weight * ripple.strength * gain
      const size = (1.5 + 2.5 * strength) * scale
      const x = (firstColumn + column) * gap * viewport.zoom + viewport.x
      const y = (firstRow + row) * gap * viewport.zoom + viewport.y
      context.globalAlpha = Math.min(0.9, 0.25 + 0.6 * strength)
      context.fillRect(x - size / 2, y - size / 2, size, size)
      painted++
    })
  }
  context.globalAlpha = 1
  return painted
}

/** Starts a ripple from the centre of the window whose session produced output. */
export function emitOutputRipple(
  field: ReturnType<typeof createRippleField>,
  sessionId: string,
  projected: readonly PixelNode[],
  nodes: readonly Node<TerminalNodeData>[],
  viewport: PixelViewport,
  scope: Element,
  now: number,
): void {
  const source = sessionId ? projected.find(node => node.sessionId === sessionId) : undefined
  const data = source ? nodes.find(node => node.id === source.id)?.data : undefined
  // Agent message events (ACP) may drive output signals later; raw PTY repaints cannot.
  if (
    !source ||
    !data ||
    data.kind !== 'terminal' ||
    resolveAgentPresentation(data).isAgent ||
    viewport.zoom <= 0
  ) {
    return
  }
  const { x, y, width, height } = source.rect
  field.emit(
    source.id,
    {
      x: (x + width / 2 - viewport.x) / viewport.zoom,
      y: (y + height / 2 - viewport.y) / viewport.zoom,
    },
    readWallLightPalette(scope)[resolveWindowKindFamily(data)],
    now,
  )
}

/** A low sonar wave from each working agent every 2.4s, keyed so it never blocks output ripples. */
export function emitSonarRipples(
  field: ReturnType<typeof createRippleField>,
  working: readonly PixelNode[],
  nodes: readonly Node<TerminalNodeData>[],
  viewport: PixelViewport,
  scope: Element,
  now: number,
): void {
  const due = working.filter(node => field.ready(`sonar:${node.id}`, now, SONAR_INTERVAL_MS))
  if (due.length === 0 || viewport.zoom <= 0) {
    return
  }
  const palette = readWallLightPalette(scope)
  for (const node of due) {
    const data = nodes.find(candidate => candidate.id === node.id)?.data
    if (!data) {
      continue
    }
    const { x, y, width, height } = node.rect
    field.emit(
      `sonar:${node.id}`,
      {
        x: (x + width / 2 - viewport.x) / viewport.zoom,
        y: (y + height / 2 - viewport.y) / viewport.zoom,
      },
      palette[resolveWindowKindFamily(data)],
      now,
      { ...SONAR_WAVE, minIntervalMs: SONAR_INTERVAL_MS },
    )
  }
}
