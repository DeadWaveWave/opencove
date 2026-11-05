import React from 'react'
import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import { PixelGlyph } from '@app/renderer/components/ui/PixelGlyph'
import {
  PIXEL_GLYPHS,
  pixelGlyphRuns,
  type PixelGlyphName,
} from '@app/renderer/components/ui/pixelGlyphs'

it('renders every 9×9 glyph as decorative rect runs covering exactly its filled cells', () => {
  for (const name of Object.keys(PIXEL_GLYPHS) as PixelGlyphName[]) {
    const rows = PIXEL_GLYPHS[name]
    expect(rows).toHaveLength(9)
    const expected: string[] = []
    rows.forEach((row, y) => {
      expect(row).toMatch(/^[.#]{9}$/)
      Array.from(row).forEach((cell, x) => {
        if (cell === '#') {
          expected.push(`${x},${y}`)
        }
      })
    })
    const runs = pixelGlyphRuns(name)
    const actual = runs.flatMap(({ x, y, width }) => {
      expect(Number.isInteger(width) && width > 0).toBe(true)
      return Array.from({ length: width }, (_, offset) => `${x + offset},${y}`)
    })
    expect(actual).toEqual(expected)

    const { container, unmount } = render(<PixelGlyph name={name} className="test-glyph" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveClass('cove-pixel-glyph', 'test-glyph')
    expect(svg).toHaveAttribute('data-cove-pixel-glyph', name)
    expect(svg).toHaveAttribute('viewBox', '0 0 9 9')
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges')
    expect(svg).toHaveAttribute('fill', 'currentColor')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('focusable', 'false')
    expect(svg).not.toHaveAttribute('tabindex')
    expect(
      Array.from(svg.children, rect => ({
        tag: rect.tagName,
        x: Number(rect.getAttribute('x')),
        y: Number(rect.getAttribute('y')),
        width: Number(rect.getAttribute('width')),
        height: Number(rect.getAttribute('height')),
      })),
    ).toEqual(runs.map(run => ({ tag: 'rect', ...run, height: 1 })))
    unmount()
  }
})
