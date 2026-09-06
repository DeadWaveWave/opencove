import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { TestInfo } from '@playwright/test'
import { clearAndSeedWorkspace, testWorkspacePath } from './workspace-canvas.helpers'

export const spaceButton = (id: string): string => `[data-testid="workspace-space-switch-${id}"]`
export type MotionSample = { t: number; x: number; y: number; zoom: number }
export type MotionResult = { samples: MotionSample[]; longFrames: number[] }
type MotionWindow = Window & { viewportMotion?: Promise<MotionResult> }

export async function seedMotionCanvas(
  page: Page,
  viewportTransition: 'fly' | 'slide',
): Promise<void> {
  await clearAndSeedWorkspace(
    page,
    [0, 1].map(index => ({
      id: `motion-note-${index}`,
      title: `Motion ${index}`,
      kind: 'note' as const,
      task: { text: `Navigation target ${index}` },
      position: { x: 300 + index * 3000, y: 200 + index * 1200 },
      width: 460,
      height: 300,
    })),
    {
      settings: {
        viewportTransition,
        focusNodeTargetZoom: 1,
        focusNodeUseVisibleCanvasCenter: false,
      },
      spaces: [0, 1].map(index => ({
        id: `motion-space-${index}`,
        name: `Motion Space ${index}`,
        directoryPath: testWorkspacePath,
        pinned: true,
        nodeIds: [`motion-note-${index}`],
        rect: { x: 260 + index * 3000, y: 160 + index * 1200, width: 540, height: 380 },
      })),
      activeSpaceId: null,
    },
  )
  await expect(page.locator(spaceButton('motion-space-0'))).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Establish an exact initial view before enabling the production animation path.
  await page.locator(spaceButton('motion-space-0')).click()
  await page.evaluate(() => {
    document.documentElement.dataset.opencoveTestViewportAnimation = 'true'
  })
}

export async function sampleMotion(
  page: Page,
  action: () => Promise<unknown>,
): Promise<MotionResult> {
  await page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport')
    if (!(viewport instanceof HTMLElement)) {
      throw new Error('Viewport missing')
    }
    const samples: MotionSample[] = []
    const longFrames: number[] = []
    const observer = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
      ? new PerformanceObserver(list =>
          longFrames.push(...list.getEntries().map(entry => entry.duration)),
        )
      : null
    observer?.observe({ type: 'long-animation-frame' })
    const start = performance.now()
    const read = (t: number): void => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform)
      samples.push({ t: t - start, x: matrix.m41, y: matrix.m42, zoom: matrix.m11 })
    }
    read(start)
    ;(window as MotionWindow).viewportMotion = new Promise(resolve => {
      const tick = (t: number): void => {
        read(t)
        if (t - start < 700) {
          requestAnimationFrame(tick)
        } else {
          observer?.disconnect()
          resolve({ samples, longFrames })
        }
      }
      requestAnimationFrame(tick)
    })
  })
  await action()
  return await page.evaluate(async () => {
    const result = await (window as MotionWindow).viewportMotion
    if (!result) {
      throw new Error('Motion sampler missing')
    }
    return result
  })
}

export function assertSlide(result: MotionResult, animated = true): void {
  const first = result.samples[0]
  const last = result.samples.at(-1)!
  if (animated) {
    const positions = new Set(result.samples.map(s => `${s.x.toFixed(2)},${s.y.toFixed(2)}`))
    expect(positions.size).toBeGreaterThan(3)
  }
  for (const sample of result.samples) {
    expect(sample.zoom).toBeGreaterThanOrEqual(Math.min(first.zoom, last.zoom) - 0.00001)
    expect(sample.zoom).toBeLessThanOrEqual(Math.max(first.zoom, last.zoom) + 0.00001)
  }
}

export function assertSameLanding(a: MotionResult, b: MotionResult): void {
  const first = a.samples.at(-1)!
  const second = b.samples.at(-1)!
  expect(Math.abs(first.x - second.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(first.zoom - second.zoom)).toBeLessThan(0.00001)
}

export async function recordMotionFrames(
  page: Page,
  testInfo: TestInfo,
): Promise<() => Promise<void>> {
  const session = await page.context().newCDPSession(page)
  const frames: { file: string; timestamp: number }[] = []
  const writes: Promise<void>[] = []
  session.on('Page.screencastFrame', event => {
    const file = `viewport-frame-${String(frames.length).padStart(5, '0')}.jpg`
    frames.push({ file, timestamp: event.metadata.timestamp ?? 0 })
    writes.push(writeFile(testInfo.outputPath(file), Buffer.from(event.data, 'base64')))
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 85,
    maxWidth: 1440,
    everyNthFrame: 1,
  })
  return async () => {
    await session.send('Page.stopScreencast')
    await Promise.all(writes)
    await writeFile(testInfo.outputPath('frames-manifest.json'), JSON.stringify(frames, null, 2))
    await session.detach()
  }
}
