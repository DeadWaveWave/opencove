import { expect, test, type Page } from '@playwright/test'
import { buildAppState, createWorkspaceDir, openAuthedCanvas, writeAppState } from './helpers'

type ViewportSample = {
  viewport: { x: number; y: number; zoom: number }
  flowAtAnchor: { x: number; y: number }
}

type MinimapPointSample = {
  clientPoint: { x: number; y: number }
  flowPosition: { x: number; y: number }
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

async function sampleCanvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const bounds = await page.locator('.workspace-canvas').evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    }
  })

  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

async function sampleMinimapPoint(
  page: Page,
  ratio: { x: number; y: number },
): Promise<MinimapPointSample> {
  const result = await page.evaluate(({ x, y }) => {
    const minimap = document.querySelector('.workspace-canvas .react-flow__minimap')
    const svg =
      minimap instanceof SVGSVGElement
        ? minimap
        : minimap instanceof HTMLElement
          ? minimap.querySelector('svg')
          : null

    if (!(svg instanceof SVGSVGElement)) {
      throw new Error('Missing minimap SVG')
    }

    const rect = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    if (rect.width <= 0 || rect.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
      throw new Error('Minimap SVG is not measurable')
    }

    return {
      clientPoint: {
        x: rect.left + rect.width * x,
        y: rect.top + rect.height * y,
      },
      flowPosition: {
        x: viewBox.x + viewBox.width * x,
        y: viewBox.y + viewBox.height * y,
      },
    }
  }, ratio)

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

  test('centers the minimap double-click target without changing zoom', async ({ page }) => {
    const workspacePath = await createWorkspaceDir('minimap-double-click')
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces: [
          {
            id: 'space-1',
            name: 'Main',
            directoryPath: workspacePath,
            nodeIds: ['near-note', 'far-note'],
            rect: { x: -200, y: -160, width: 3200, height: 2400 },
          },
        ],
        nodes: [
          {
            id: 'near-note',
            title: 'Near note',
            kind: 'note',
            position: { x: 0, y: 0 },
            width: 360,
            height: 240,
            text: 'near',
          },
          {
            id: 'far-note',
            title: 'Far note',
            kind: 'note',
            position: { x: 2400, y: 1700 },
            width: 360,
            height: 240,
            text: 'far',
          },
        ],
      }),
    )

    await openAuthedCanvas(page)

    const canvas = page.locator('.workspace-canvas')
    await expect(canvas).toBeVisible()
    await expect(page.locator('.workspace-canvas .react-flow__minimap')).toBeVisible()

    const canvasCenter = await sampleCanvasCenter(page)
    await page.mouse.move(canvasCenter.x, canvasCenter.y)
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(60)

    const target = await sampleMinimapPoint(page, { x: 0.78, y: 0.76 })
    const before = await sampleViewportAt(page, canvasCenter)
    expect(before.viewport.zoom).toBeGreaterThan(1)

    await page.mouse.dblclick(target.clientPoint.x, target.clientPoint.y)

    await expect
      .poll(async () => {
        const sample = await sampleViewportAt(page, canvasCenter)
        return Math.hypot(
          sample.flowAtAnchor.x - target.flowPosition.x,
          sample.flowAtAnchor.y - target.flowPosition.y,
        )
      })
      .toBeLessThan(20)

    const after = await sampleViewportAt(page, canvasCenter)
    expect(Math.abs(after.viewport.zoom - before.viewport.zoom)).toBeLessThan(0.01)
  })
})
