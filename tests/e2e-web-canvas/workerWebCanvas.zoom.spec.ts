import { expect, test, type Page } from '@playwright/test'
import { buildAppState, createWorkspaceDir, openAuthedCanvas, writeAppState } from './helpers'

type ViewportSample = {
  viewport: { x: number; y: number; zoom: number }
  flowAtAnchor: { x: number; y: number }
}

async function sampleViewportAt(
  page: Page,
  anchor: { x: number; y: number },
): Promise<ViewportSample> {
  const result = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('.workspace-canvas')
    const viewportEl = document.querySelector('.react-flow__viewport')

    if (!(canvas instanceof HTMLElement) || !(viewportEl instanceof HTMLElement)) {
      throw new Error('Missing canvas or viewport element')
    }

    const rect = canvas.getBoundingClientRect()
    const transform = window.getComputedStyle(viewportEl).transform
    const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform)

    const zoom = Number.isFinite(matrix.a) && matrix.a > 0 ? matrix.a : 1
    const viewportX = Number.isFinite(matrix.e) ? matrix.e : 0
    const viewportY = Number.isFinite(matrix.f) ? matrix.f : 0

    const localX = x - rect.left
    const localY = y - rect.top

    return {
      viewport: { x: viewportX, y: viewportY, zoom },
      flowAtAnchor: {
        x: (localX - viewportX) / zoom,
        y: (localY - viewportY) / zoom,
      },
    }
  }, anchor)

  return result
}

test.describe('Worker web canvas zoom anchor', () => {
  test('keeps the flow anchor stable while zooming', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('zoom-anchor')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: [],
            rect: { x: 0, y: 0, width: 1200, height: 800 },
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const canvas = page.locator('.workspace-canvas')
    await expect(canvas).toBeVisible()

    const bounds = await canvas.boundingBox()
    expect(bounds).toBeTruthy()

    const anchor = {
      x: (bounds!.x ?? 0) + (bounds!.width ?? 0) / 2,
      y: (bounds!.y ?? 0) + (bounds!.height ?? 0) / 2,
    }

    await page.mouse.move(anchor.x, anchor.y)

    const before = await sampleViewportAt(page, anchor)
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(60)
    const after = await sampleViewportAt(page, anchor)

    expect(after.viewport.zoom).toBeGreaterThan(before.viewport.zoom)
    expect(Math.abs(after.flowAtAnchor.x - before.flowAtAnchor.x)).toBeLessThan(0.75)
    expect(Math.abs(after.flowAtAnchor.y - before.flowAtAnchor.y)).toBeLessThan(0.75)
  })
})
