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
    // The wall is one flat colour: no grid, no grain and no canvas overlays (the dock, the minimap
    // and the zoom controls can float over a window on a small screen), so only the window's own
    // layers vary.
    style.textContent = `.workspace-canvas .react-flow { background: ${backdrop} !important; }
      .react-flow__background { display: none; }
      .workspace-canvas__action-bar, .workspace-canvas__minimap, .workspace-canvas__minimap-toggle,
      .react-flow__controls, .workspace-canvas-hud__lod { visibility: hidden !important; }
      :root { --cove-glass-grain-dark: none !important; --cove-glass-grain-light: none !important; }`
  }, color)
}

/**
 * Glass shows the wall only where the system lets it: a CI Mac reports reduced transparency, which
 * turns every frame solid (window-material spec). The probes need the see-through glass.
 */
async function showGlass(window: Page): Promise<void> {
  const session = await window.context().newCDPSession(window)
  await session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }],
  })
}

/** Clicks the canvas where nothing covers it, which clears the selection at any window size. */
async function clickEmptyCanvas(window: Page): Promise<void> {
  const point = await window.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')!
    const box = pane.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight) - 16
    const right = Math.min(box.right, window.innerWidth) - 16
    for (let y = bottom; y > box.top; y -= 24) {
      for (let x = box.left + 16; x < right; x += 24) {
        if (document.elementFromPoint(x, y) === pane) {
          return { x, y }
        }
      }
    }
    return null
  })
  expect(point, 'an empty spot on the canvas').not.toBeNull()
  await window.mouse.click(point!.x, point!.y)
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

/** Pixels whose colour lies between 10% and 90% of the way from the run's first to its last. */
function rampWidth(run: Rgb[]): number {
  const first = run[0]!
  const last = run.at(-1)!
  const channel = [0, 1, 2].reduce((best, c) =>
    Math.abs(last[c]! - first[c]!) > Math.abs(last[best]! - first[best]!) ? c : best,
  )
  const change = last[channel]! - first[channel]!
  return run.filter(pixel => {
    const t = (pixel[channel]! - first[channel]!) / change
    return t > 0.1 && t < 0.9
  }).length
}

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
      // How far in from the window's edge the plate turns solid.
      feather: parseFloat(
        getComputedStyle(element).getPropertyValue('--cove-reading-plate-feather'),
      ),
    }
  })
}

/** Canvas zoom steps from ctrl+wheel deltas: 1, then about 0.6, 0.3, 0.54, 1.23 and 2. */
const ZOOM_WHEEL_DELTAS = [0, 37, 51, -43, -60, -40] as const

/**
 * How smooth the plate's fade is around both bottom corners and along the bottom edge, in device
 * pixels: the worst second difference across or down, and the worst step between neighbouring
 * columns of the bottom fade. Edge tiles butted together seam at fractional zoom, which shows as
 * a spike in the second difference far above what the smoothstep itself bends by.
 */
async function readFadeSmoothness(window: Page, node: Locator) {
  const zoom = await window.evaluate(
    () =>
      new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform).a,
  )
  const geo = await node.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      radius: parseFloat(getComputedStyle(element).borderBottomLeftRadius),
      feather: parseFloat(
        getComputedStyle(element).getPropertyValue('--cove-reading-plate-feather'),
      ),
    }
  })
  const feather = geo.feather * zoom
  const radius = geo.radius * zoom
  // Clear of the frame's 1px border and rim, which scale with the canvas.
  const pad = 3 * Math.max(1, zoom)
  const clip = {
    x: Math.floor(geo.left),
    y: Math.floor(geo.bottom - feather - 2 * pad - 2),
    width: Math.ceil(geo.right - geo.left),
    height: Math.ceil(feather + 2 * pad + 2),
  }
  const png = await window.screenshot({ clip, animations: 'disabled' })
  const smoothness = await window.evaluate(
    async ({ base64, clip: box, geo: frame, feather: f, radius: r, pad: p }) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      const scale = width / box.width
      const pixel = (x: number, y: number) => [0, 1, 2].map(c => data[(y * width + x) * 4 + c]!)
      const bend = (a: number[], b: number[], c: number[]) =>
        Math.max(...a.map((value, i) => Math.abs(2 * b[i]! - value - c[i]!)))
      const toX = (page: number) => Math.round((page - box.x) * scale)
      const toY = (page: number) => Math.round((page - box.y) * scale)
      const yMin = toY(frame.bottom - f - p)
      const yMax = Math.min(height - 2, toY(frame.bottom - p))
      const middle = (frame.left + frame.right) / 2
      // Outside the frame's own rounded corner, which curves through each corner's box.
      const clearOfCorner = (x: number, y: number, centreX: number) => {
        const px = x / scale + box.x
        const py = y / scale + box.y
        const centreY = frame.bottom - r
        const beside = centreX < middle ? px < centreX : px > centreX
        return !(beside && py > centreY && Math.hypot(px - centreX, py - centreY) > r - p - 1)
      }
      const corners = [
        { from: toX(frame.left + p), to: toX(frame.left + f + p), centreX: frame.left + r },
        { from: toX(frame.right - f - p), to: toX(frame.right - p), centreX: frame.right - r },
      ]
      let worstBend = 0
      for (const { from, to, centreX } of corners) {
        for (let y = yMin + 1; y < yMax; y++) {
          for (let x = from + 1; x < to; x++) {
            const around = [
              [x, y],
              [x - 1, y - 1],
              [x + 1, y + 1],
              [x - 1, y + 1],
              [x + 1, y - 1],
            ]
            if (!around.every(([ax, ay]) => clearOfCorner(ax!, ay!, centreX))) {
              continue
            }
            worstBend = Math.max(
              worstBend,
              bend(pixel(x - 1, y), pixel(x, y), pixel(x + 1, y)),
              bend(pixel(x, y - 1), pixel(x, y), pixel(x, y + 1)),
            )
          }
        }
      }
      let worstStripe = 0
      for (let y = yMin; y <= yMax; y++) {
        for (let x = corners[0]!.to + 2; x < corners[1]!.from - 2; x++) {
          const next = pixel(x + 1, y)
          worstStripe = Math.max(worstStripe, ...pixel(x, y).map((v, i) => Math.abs(v - next[i]!)))
        }
      }
      const columnX = toX(middle)
      const span = Math.max(
        ...[0, 1, 2].map(c => Math.abs(pixel(columnX, yMin)[c]! - pixel(columnX, yMax)[c]!)),
      )
      // A smoothstep over `w` pixels bends by at most 6 * span / w² per pixel; 8-bit rounding and
      // the rim's antialiasing add a few levels.
      const w = f * scale
      return { worstBend, worstStripe, bound: Math.ceil((6 * span) / (w * w)) + 5 }
    },
    { base64: png.toString('base64'), clip, geo, feather, radius, pad },
  )
  return { zoom, ...smoothness }
}

test.describe('Workspace Canvas - Solid reading plate', () => {
  test('content sits on a solid plate that melts into the glass frame on every side', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await showGlass(window)
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
        await expect(window.locator('html')).toHaveAttribute('data-cove-transparency', 'full')
        // Nothing selected: a selection frame is not the plate's edge.
        await clickEmptyCanvas(window)

        for (const kind of nodes) {
          const node = window.locator(`.${kind}-node`).first()
          await expect(node).toBeVisible()
          const { frame, header, plate, feather } = await readGeometry(node)
          const clip = {
            x: frame.left,
            y: frame.top,
            width: frame.right - frame.left,
            height: frame.bottom - frame.top,
          }
          const midY = Math.round((plate.top + plate.bottom) / 2)
          const midX = Math.round((plate.left + plate.right) / 2)
          const probe = { x: midX, y: Math.round(plate.top + (plate.bottom - plate.top) * 0.6) }
          // From inside the frame's rim to just past where the plate turns solid.
          const inner = feather + 2
          const crossings: Record<string, Point[]> = {
            left: line({ x: frame.left + 2, y: midY }, { x: frame.left + inner, y: midY }),
            right: line({ x: frame.right - 3, y: midY }, { x: frame.right - 1 - inner, y: midY }),
            bottom: line(
              { x: midX, y: frame.bottom - 3 },
              { x: midX, y: frame.bottom - 1 - inner },
            ),
            'header side': line(
              { x: frame.left + 2, y: header.bottom - 4 },
              { x: frame.left + inner, y: header.bottom - 4 },
            ),
          }
          // A terminal's scrollbar runs down its right side, inside the ramp; that side mirrors
          // the left one.
          if (kind === 'terminal') {
            delete crossings.right
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
                // And the ramp is wide (owner call, round 4): its middle 80% of the change spreads
                // over close to half the feather, as a smoothstep does, not over a pixel or two.
                expect(
                  rampWidth(run),
                  `${label} ${side} on ${backdrop}: ramp width`,
                ).toBeGreaterThanOrEqual(Math.floor(feather * 0.45))
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

  test('the plate fades without a seam at any canvas zoom', async () => {
    const { electronApp, window } = await launchApp({ deviceScaleFactor: 2 })

    try {
      await showGlass(window)
      // CI's virtual screen holds about 800×600 page px at 2×. With the sidebar folded away, the
      // note sits in the middle of the canvas at its smallest size, so it stays on screen at 2× zoom.
      const settings = { isPrimarySidebarCollapsed: true, ...PIXEL_EFFECTS_DISABLED }
      await clearAndSeedWorkspace(window, [], { settings })
      await expect(window.locator('.react-flow__pane').first()).toBeVisible()
      const pane = await window.evaluate(() => {
        const box = document.querySelector('.react-flow__pane')!.getBoundingClientRect()
        return { width: Math.min(box.width, window.innerWidth - box.left), height: box.height }
      })
      const size = { width: 220, height: 140 }
      const position = {
        x: Math.round(pane.width / 2 - size.width / 2),
        y: Math.round(pane.height / 2 - size.height / 2),
      }
      for (const uiTheme of ['dark', 'light'] as const) {
        await clearAndSeedWorkspace(
          window,
          [
            {
              id: 'plate-zoom-note',
              title: 'plate zoom note',
              position,
              ...size,
              kind: 'note',
              task: { text: '' },
            },
          ],
          { settings: { uiTheme, ...settings } },
        )
        const node = window.locator('.note-node').first()
        await expect(node).toBeVisible()
        await setBackdrop(window, BACKDROPS[0])
        await clickEmptyCanvas(window)

        for (const delta of ZOOM_WHEEL_DELTAS) {
          if (delta !== 0) {
            // Zoom about a point just under the note, so its bottom corners stay where they are.
            const box = (await node.boundingBox())!
            await window.mouse.move(box.x + box.width / 2, box.y + box.height + 8)
            await window.keyboard.down('Control')
            await window.mouse.wheel(0, delta)
            await window.keyboard.up('Control')
            await window.waitForTimeout(400)
          }
          const fade = await readFadeSmoothness(window, node)
          const label = `${uiTheme} at zoom ${fade.zoom.toFixed(2)}`
          expect(fade.worstBend, `${label}: a line inside the fade`).toBeLessThanOrEqual(fade.bound)
          expect(
            fade.worstStripe,
            `${label}: a column break along the bottom fade`,
          ).toBeLessThanOrEqual(2)
        }
      }
    } finally {
      await electronApp.close()
    }
  })
})
