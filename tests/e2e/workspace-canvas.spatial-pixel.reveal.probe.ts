import type { ElectronApplication, Page } from '@playwright/test'
import type { TerminalRenderMetricsTestProjection } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'

export interface RevealSample {
  time: number
  front: number
  masked: boolean
  ready: boolean
  shown: boolean
  assembling: boolean
  width: number
  height: number
}
export interface RevealRecord {
  id: string
  kind: 'note' | 'terminal'
  preparedAt: number | null
  dom: RevealSample & { maskImage: string }
  firstRaf: RevealSample | null
  firstFrameVisible: RevealSample | null
  /** Content readiness is measured independently and never gates frame visibility. */
  readyAt: number | null
  firstVisible: RevealSample | null
  fullAt: number | null
  samples: RevealSample[]
}
interface RevealProbe {
  records: Record<string, RevealRecord>
  pointer: { time: number; id: string | null; front: number; masked: boolean } | null
  dispose: () => void
}
type ProbeWindow = Window & {
  __pixelRevealProbe?: RevealProbe
  __opencoveTerminalSelectionTestApi?: {
    getRenderMetrics: (nodeId: string) => TerminalRenderMetricsTestProjection | null
  }
}

export interface RevealCapture {
  id: string
  phase: string
  front: number
  time: number
  marker: { x: number; y: number }
  viewportWidth: number
  viewportHeight: number
  png?: string
  pinkPixels?: number
  samplePixels?: number
  sampleColor?: number[]
  decodedSize?: { width: number; height: number }
  decodedColorSpace?: string
  error?: string
}

/** Captures on a renderer RAF signal directly in main, without a Playwright round-trip per frame. */
export async function installRevealCapture(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0]
    if (!target) {
      throw new Error('No renderer window for reveal capture')
    }
    const registry = globalThis as unknown as { __pixelRevealCaptures: RevealCapture[] }
    registry.__pixelRevealCaptures = []
    target.webContents.on('console-message', details => {
      const prefix = 'OPENCOVE_PIXEL_REVEAL_CAPTURE:'
      if (!details.message.startsWith(prefix)) {
        return
      }
      const payload = JSON.parse(details.message.slice(prefix.length)) as RevealCapture & {
        marker: { x: number; y: number }
        viewportWidth: number
        viewportHeight: number
      }
      const capture: RevealCapture = {
        id: payload.id,
        phase: payload.phase,
        front: payload.front,
        time: payload.time,
        marker: payload.marker,
        viewportWidth: payload.viewportWidth,
        viewportHeight: payload.viewportHeight,
      }
      registry.__pixelRevealCaptures.push(capture)
      void target.webContents
        .capturePage()
        .then(image => {
          const png = image.toPNG()
          capture.png = png.toString('base64')
        })
        .catch(error => {
          capture.error = String(error)
        })
    })
  })
}

/** Respect the PNG's embedded display profile before comparing it with a CSS sRGB test color. */
export async function sampleRevealCapture(
  page: Page,
  capture: RevealCapture,
): Promise<RevealCapture> {
  if (!capture.png) {
    return capture
  }
  const sample = await page.evaluate(async payload => {
    const image = new Image()
    image.src = `data:image/png;base64,${payload.png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })
    if (!context) {
      throw new Error('No sRGB context for screenshot color verification')
    }
    context.drawImage(image, 0, 0)
    const x = Math.round((payload.marker.x * canvas.width) / payload.viewportWidth)
    const y = Math.round((payload.marker.y * canvas.height) / payload.viewportHeight)
    const data = context.getImageData(x - 2, y - 2, 5, 5, { colorSpace: 'srgb' }).data
    let pinkPixels = 0
    for (let offset = 0; offset < data.length; offset += 4) {
      if (
        data[offset] > 235 &&
        data[offset + 1] < 25 &&
        data[offset + 2] > 235 &&
        data[offset + 3] > 235
      ) {
        pinkPixels++
      }
    }
    return {
      pinkPixels,
      samplePixels: data.length / 4,
      sampleColor: [...data.slice(48, 52)],
      decodedSize: { width: canvas.width, height: canvas.height },
      decodedColorSpace: context.getContextAttributes().colorSpace,
    }
  }, capture)
  return { ...capture, ...sample }
}

export async function readRevealCaptures(
  electronApp: ElectronApplication,
): Promise<RevealCapture[]> {
  return await electronApp.evaluate(
    () =>
      (globalThis as unknown as { __pixelRevealCaptures: RevealCapture[] }).__pixelRevealCaptures ??
      [],
  )
}

/** Test-only DOM/RAF observation. It never changes masks, runtime readiness, or animation clocks. */
export async function installRevealProbe(page: Page, capture = false): Promise<void> {
  await page.evaluate(captureFrames => {
    const host = window as ProbeWindow
    host.__pixelRevealProbe?.dispose()
    const initial = new Set(
      [...document.querySelectorAll('.react-flow__node')].map(node => node.getAttribute('data-id')),
    )
    const prepared = new Map<string, number>()
    const sent = new Set<string>()
    const marker = document.createElement('div')
    marker.dataset.testid = 'pixel-reveal-underlay'
    marker.style.cssText =
      'position:fixed;width:14px;height:14px;background:rgb(255,0,255);pointer-events:none;z-index:1;'
    if (captureFrames) {
      document.querySelector('.react-flow')?.append(marker)
    }
    let raf = 0
    let disposed = false
    const probe: RevealProbe = { records: {}, pointer: null, dispose: () => undefined }
    host.__pixelRevealProbe = probe

    const sample = (node: HTMLElement): RevealSample & { maskImage: string } => {
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      const parsed = Number.parseFloat(style.getPropertyValue('--cove-pixel-reveal-front'))
      const terminal = node.querySelector<HTMLElement>('.terminal-node__terminal')
      const metrics = terminal
        ? host.__opencoveTerminalSelectionTestApi?.getRenderMetrics(node.dataset.id ?? '')
        : null
      const surfaceReady =
        !!metrics &&
        (metrics.cssCanvasWidth ?? 0) > 0 &&
        (metrics.cssCanvasHeight ?? 0) > 0 &&
        (metrics.rendererHasWebglCanvas === true || (metrics.rendererDomRowElementCount ?? 0) > 0)
      const ready = terminal
        ? terminal.getAttribute('aria-busy') === 'false' &&
          !!terminal.querySelector('.xterm') &&
          surfaceReady
        : !!node.querySelector('[data-testid="note-node-textarea"]')
      return {
        time: performance.now(),
        front: Number.isFinite(parsed) ? parsed : 1,
        masked: style.maskImage !== 'none',
        maskImage: style.maskImage,
        ready,
        assembling:
          document
            .querySelector('[data-testid="workspace-pixel-assembly"]')
            ?.getAttribute('data-cove-pixel-node-ids')
            ?.split(' ')
            .includes(node.dataset.id ?? '') ?? false,
        shown:
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0,
        width: rect.width,
        height: rect.height,
      }
    }
    const captureFrame = (node: HTMLElement, value: RevealSample, phase: string) => {
      if (!captureFrames || sent.has(`${node.dataset.id}:${phase}`)) {
        return
      }
      sent.add(`${node.dataset.id}:${phase}`)
      const rect = node.getBoundingClientRect()
      const point = { x: rect.left + rect.width * 0.95, y: rect.top + rect.height * 0.6 }
      marker.style.left = `${point.x - 7}px`
      marker.style.top = `${point.y - 7}px`
      // eslint-disable-next-line no-console
      console.info(
        `OPENCOVE_PIXEL_REVEAL_CAPTURE:${JSON.stringify({
          id: node.dataset.id,
          phase,
          front: value.front,
          time: value.time,
          marker: point,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        })}`,
      )
    }
    const discover = () => {
      for (const node of document.querySelectorAll<HTMLElement>('.react-flow__node')) {
        const id = node.dataset.id
        if (!id || initial.has(id) || probe.records[id]) {
          continue
        }
        if (!node.querySelector('.note-node, .terminal-node')) {
          continue
        }
        probe.records[id] = {
          id,
          kind: node.querySelector('.terminal-node') ? 'terminal' : 'note',
          preparedAt: prepared.get(id) ?? null,
          dom: sample(node),
          firstRaf: null,
          firstFrameVisible: null,
          readyAt: null,
          firstVisible: null,
          fullAt: null,
          samples: [],
        }
      }
      if (!raf && !disposed && Object.keys(probe.records).length) {
        raf = requestAnimationFrame(tick)
      }
    }
    const tick = () => {
      raf = 0
      let active = false
      for (const record of Object.values(probe.records)) {
        const node = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(record.id)}"]`,
        )
        if (!node || record.samples.length >= 180) {
          continue
        }
        const value = sample(node)
        record.samples.push(value)
        record.firstRaf ??= value
        if (value.shown && value.front > 0) {
          record.firstFrameVisible ??= value
        }
        if (value.ready && value.shown) {
          record.readyAt ??= value.time
        }
        if (value.ready && value.shown && value.front > 0) {
          record.firstVisible ??= value
        }
        if (value.shown && !value.masked) {
          record.fullAt ??= value.time
        }
        if (record.samples.length === 1) {
          captureFrame(node, value, 'first-raf')
        }
        if (value.shown && value.front >= 0.04 && value.front <= 0.55) {
          captureFrame(node, value, 'partial')
        }
        active ||= !record.fullAt || !record.readyAt || value.time - record.fullAt < 80
      }
      if (active && !disposed) {
        raf = requestAnimationFrame(tick)
      }
    }
    const onPrepared = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeIds: string[]; createdAt: number }>).detail
      detail.nodeIds.forEach(id => prepared.set(id, detail.createdAt))
    }
    const onPointer = (event: PointerEvent) => {
      const node =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('.react-flow__node')
          : null
      const value = node ? sample(node) : null
      probe.pointer = {
        time: performance.now(),
        id: node?.dataset.id ?? null,
        front: value?.front ?? 1,
        masked: value?.masked ?? false,
      }
    }
    const observer = new MutationObserver(discover)
    observer.observe(document, { childList: true, subtree: true })
    window.addEventListener('opencove-workspace-node-creation-prepared', onPrepared)
    window.addEventListener('pointerdown', onPointer, true)
    probe.dispose = () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      marker.remove()
      window.removeEventListener('opencove-workspace-node-creation-prepared', onPrepared)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, capture)
}

export async function readRevealRecords(page: Page): Promise<RevealRecord[]> {
  return await page.evaluate(() =>
    Object.values((window as ProbeWindow).__pixelRevealProbe?.records ?? {}),
  )
}

/** Finish collecting content diagnostics after the frame clock ends; never gate the animation on them. */
export async function settleRevealContentDiagnostic(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Object.values((window as ProbeWindow).__pixelRevealProbe?.records ?? {}).every(
        record =>
          record.fullAt !== null &&
          (record.readyAt !== null || performance.now() - record.fullAt >= 500),
      ),
    undefined,
    { timeout: 2_000 },
  )
}

export async function maskedInputPoint(page: Page) {
  return await page.evaluate(async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const probe = (window as ProbeWindow).__pixelRevealProbe
      const record = Object.values(probe?.records ?? {}).at(-1)
      if (record?.firstFrameVisible) {
        const node = document.querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(record.id)}"]`,
        )
        const input = node?.querySelector<HTMLElement>(
          '[data-testid="note-node-textarea"], .terminal-node__terminal',
        )
        if (node && input) {
          const rect = input.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) {
            const front = Number.parseFloat(
              getComputedStyle(node).getPropertyValue('--cove-pixel-reveal-front'),
            )
            return {
              id: record.id,
              x: rect.left + rect.width * 0.9,
              y: rect.top + rect.height * 0.5,
              front,
            }
          }
        }
      }
      // Observe the actual frame, without waiting for PTY hydration or terminal text readiness.
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
    throw new Error('New node did not present a visible frame with an input hit region')
  })
}

export async function readRevealPointer(page: Page) {
  return await page.evaluate(() => (window as ProbeWindow).__pixelRevealProbe?.pointer ?? null)
}
