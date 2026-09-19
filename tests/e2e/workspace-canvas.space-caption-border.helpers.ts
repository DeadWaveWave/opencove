import { expect, type Page } from '@playwright/test'
import { readSpaceIdentity } from './workspace-canvas.color-identity.helpers'

export async function expectSpaceFrameHeader(page: Page) {
  await expect(async () => {
    const corners = await page.locator('.workspace-space-region').evaluateAll(elements =>
      elements.map(region => {
        const edge = getComputedStyle(region, '::before')
        const corner = getComputedStyle(region, '::after')
        return {
          mask: corner.maskImage,
          width: Number.parseFloat(corner.borderTopWidth),
          edgeWidth: Number.parseFloat(edge.borderTopWidth),
          clip: corner.clipPath,
          edgeClip: edge.clipPath,
        }
      }),
    )
    expect(corners.length).toBeGreaterThan(0)
    for (const corner of corners) {
      expect(corner.mask).not.toContain('radial-gradient')
      expect(corner.width).toBeGreaterThanOrEqual(corner.edgeWidth * 2)
      expect(corner.clip).toBe(corner.edgeClip)
    }
    for (const space of await readSpaceIdentity(page)) {
      const evidence = `${space.id} ${JSON.stringify({ rect: space.rect, clip: space.edge.clip, points: space.edge.clipPoints, captions: space.edge.captions, gaps: space.edge.gaps })}`
      expect(space.edge.clip, `clipped top edge: ${evidence}`).toContain('polygon(')
      expect(space.edge.preservesOtherEdges, `remaining frame edges: ${evidence}`).toBe(true)
      for (const caption of space.edge.captions) {
        expect(
          space.edge.gaps.some(gap => gap.left <= caption.left && gap.right >= caption.right),
          `${caption.kind} border must be absent under its visible caption: ${evidence}`,
        ).toBe(true)
      }
      for (const gap of space.edge.gaps) {
        const captions = space.edge.captions.filter(
          caption => caption.right >= gap.left && caption.left <= gap.right,
        )
        expect(
          captions.length,
          `gap must correspond to visible captions: ${evidence}`,
        ).toBeGreaterThan(0)
        const expectedLeft = Math.max(
          space.rect.x,
          Math.min(...captions.map(caption => caption.left)) - 3,
        )
        const expectedRight = Math.min(
          space.rect.x + space.rect.width,
          Math.max(...captions.map(caption => caption.right)) + 3,
        )
        expect(
          Math.abs(gap.left - expectedLeft),
          `left padding expected ${expectedLeft}: ${evidence}`,
        ).toBeLessThan(0.1)
        expect(
          Math.abs(gap.right - expectedRight),
          `right padding expected ${expectedRight}: ${evidence}`,
        ).toBeLessThan(0.1)
        expect(gap.depth, `gap must clear the entire top stroke: ${evidence}`).toBeGreaterThan(
          space.edge.width * space.edge.actualScale,
        )
        expect(
          gap.depth,
          `gap must remain confined to top stroke: ${evidence}`,
        ).toBeLessThanOrEqual(4.1)
      }
    }
  }).toPass({ timeout: 5000 })
}
