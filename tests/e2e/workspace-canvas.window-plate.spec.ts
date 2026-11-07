/* eslint-disable no-await-in-loop -- Themes, backdrops and windows share one Electron window and are read in turn. */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { PIXEL_EFFECTS_DISABLED } from './workspace-canvas.pixel-effects.helpers'

type Rgb = [number, number, number]
type Point = { x: number; y: number }

/** Two loud, unlike walls: whatever shows through the glass differs between them. */
const BACKDROPS = ['rgb(255 0 170)', 'rgb(0 200 80)'] as const

const CASES = (['dark', 'light'] as const).flatMap(uiTheme => [
  { uiTheme, terminalBackground: 'transparent' as const, nodes: ['terminal', 'task', 'note'] },
  { uiTheme, terminalBackground: 'opaque' as const, nodes: ['terminal'] },
])

async function setBackdrop(window: Page, color: string): Promise<void> {
  await window.evaluate(backdrop => {
    const style =
      document.getElementById('window-plate-backdrop') ??
      document.head.appendChild(
        Object.assign(document.createElement('style'), { id: 'window-plate-backdrop' }),
      )
    // The wall is one flat colour: no grid, no grain, so only the window's own layers vary.
    style.textContent = `.workspace-canvas .react-flow { background: ${backdrop} !important; }
      .react-flow__background { display: none; }
      :root { --cove-glass-grain-dark: none !important; --cove-glass-grain-light: none !important; }`
  }, color)
}

/** The screen colours at `points` (page px) inside `clip`. */
async function readPixels(
  window: Page,
  clip: { x: number; y: number; width: number; height: number },
  points: Point[],
): Promise<Rgb[]> {
  const png = await window.screenshot({ clip, animations: 'disabled' })
  return await window.evaluate(
    async ({ base64, origin, cssWidth, points: probes }) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      // The screenshot is in device pixels; probes are page px.
      const scale = width / cssWidth
      return probes.map(({ x, y }) => {
        const row = Math.floor((Math.round(y) - origin.y + 0.5) * scale)
        const column = Math.floor((Math.round(x) - origin.x + 0.5) * scale)
        const offset = (row * width + column) * 4
        return [data[offset]!, data[offset + 1]!, data[offset + 2]!] as Rgb
      })
    },
    {
      base64: png.toString('base64'),
      origin: { x: clip.x, y: clip.y },
      cssWidth: clip.width,
      points,
    },
  )
}

const channelGap = (a: Rgb, b: Rgb): number =>
  Math.max(...a.map((value, i) => Math.abs(value - b[i]!)))

/** Pixel centres from `from` to `to` along one axis, one per screen pixel. */
function line(from: Point, to: Point): Point[] {
  const steps = Math.round(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)))
  return Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }))
}

/** Where each window is read: its plate, and lines crossing from the frame into the plate. */
async function readGeometry(node: Locator) {
  return await node.evaluate(element => {
    const round = (rect: DOMRect) => ({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    })
    return {
      frame: round(element.getBoundingClientRect()),
      header: round(
        element.querySelector('[data-cove-part="window-header"]')!.getBoundingClientRect(),
      ),
      plate: round(
        element.querySelector('[data-cove-part="window-body"]')!.getBoundingClientRect(),
      ),
    }
  })
}

test.describe('Workspace Canvas - Solid reading plate', () => {
  test('content sits on a solid plate that melts into the glass frame on every side', async () => {
    const { electronApp, window } = await launchApp()

    try {
      for (const { uiTheme, terminalBackground, nodes } of CASES) {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'plate-terminal',
              title: 'plate terminal',
              position: { x: 40, y: 100 },
              width: 420,
              height: 280,
            },
            {
              id: 'plate-task',
              title: 'plate task',
              position: { x: 500, y: 100 },
              width: 380,
              height: 320,
              kind: 'task',
              task: {
                requirement: 'Keep the wall out of the content.',
                status: 'doing',
                priority: 'medium',
                tags: [],
                linkedAgentNodeId: null,
                lastRunAt: null,
                autoGeneratedTitle: false,
              },
            },
            {
              id: 'plate-note',
              title: 'plate note',
              position: { x: 40, y: 420 },
              width: 320,
              height: 220,
              kind: 'note',
              task: { text: 'Release notes' },
            },
          ],
          { settings: { uiTheme, terminalBackground, ...PIXEL_EFFECTS_DISABLED } },
        )
        await expect
          .poll(() => window.evaluate(() => document.documentElement.dataset.coveTheme ?? null))
          .toBe(uiTheme)
        // Nothing selected: a selection frame is not the plate's edge.
        await window
          .locator('.react-flow__pane')
          .first()
          .click({ position: { x: 300, y: 760 } })

        for (const kind of nodes) {
          const node = window.locator(`.${kind}-node`).first()
          await expect(node).toBeVisible()
          const { frame, header, plate } = await readGeometry(node)
          const clip = {
            x: frame.left,
            y: frame.top,
            width: frame.right - frame.left,
            height: frame.bottom - frame.top,
          }
          const midY = Math.round((plate.top + plate.bottom) / 2)
          const midX = Math.round((plate.left + plate.right) / 2)
          const probe = { x: midX, y: Math.round(plate.top + (plate.bottom - plate.top) * 0.6) }
          const crossings = {
            left: line({ x: frame.left + 2, y: midY }, { x: plate.left + 4, y: midY }),
            right: line({ x: frame.right - 3, y: midY }, { x: plate.right - 5, y: midY }),
            bottom: line({ x: midX, y: frame.bottom - 3 }, { x: midX, y: plate.bottom - 5 }),
            'header side': line(
              { x: frame.left + 2, y: header.bottom - 4 },
              { x: plate.left + 2, y: header.bottom - 4 },
            ),
          }
          const label = `${uiTheme} ${terminalBackground} ${kind}`

          const plateColours: Rgb[] = []
          for (const backdrop of BACKDROPS) {
            await setBackdrop(window, backdrop)
            const lines = Object.values(crossings)
            const pixels = await readPixels(window, clip, [probe, ...lines.flat()])
            plateColours.push(pixels[0]!)
            let offset = 1
            for (const [side, points] of Object.entries(crossings)) {
              const run = pixels.slice(offset, offset + points.length)
              offset += points.length
              // Frame to plate is a ramp, not a step: no two neighbouring pixels jump by more than
              // 40% of the whole change. A plate edge, an inner line or a hard side is one step.
              const span = channelGap(run[0]!, run.at(-1)!)
              const step = Math.max(...run.slice(1).map((pixel, i) => channelGap(pixel, run[i]!)))
              // The probe is only fair where the wall shows through the frame. Light glass is lit
              // almost white near its top, so beside the header the wall barely shows.
              if (side !== 'header side') {
                expect(
                  span,
                  `${label} ${side} on ${backdrop}: the wall shows in the frame`,
                ).toBeGreaterThanOrEqual(24)
              }
              expect(
                step,
                `${label} ${side} on ${backdrop}: ${JSON.stringify(run)}`,
              ).toBeLessThanOrEqual(Math.ceil(span * 0.4) + 2)
            }
          }
          // The plate is solid: the wall behind it does not change its colour.
          expect(
            channelGap(plateColours[0]!, plateColours[1]!),
            `${label} plate`,
          ).toBeLessThanOrEqual(2)
        }
      }
    } finally {
      await electronApp.close()
    }
  })
})
