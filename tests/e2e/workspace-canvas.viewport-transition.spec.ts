import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp, readCanvasViewport, selectCoveOption } from './workspace-canvas.helpers'
import {
  assertSameLanding,
  assertSlide,
  recordMotionFrames,
  sampleMotion,
  seedMotionCanvas,
  spaceButton,
} from './workspace-canvas.viewport-transition.helpers'

test('switches viewport effects live, preserves their endpoints, and handles interruptions', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  const errors: string[] = []
  window.on('pageerror', error => errors.push(error.message))
  let stopRecording: (() => Promise<void>) | undefined
  try {
    await seedMotionCanvas(window, 'fly')
    stopRecording = await recordMotionFrames(window, testInfo)
    const fly = await sampleMotion(window, () =>
      window.locator(spaceButton('motion-space-1')).click(),
    )
    expect(Math.min(...fly.samples.map(s => s.zoom))).toBeLessThan(fly.samples[0].zoom - 0.05)
    await window.locator(spaceButton('motion-space-0')).click()
    await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeCloseTo(1, 4)

    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-canvas').click()
    await selectCoveOption(window, 'settings-viewport-transition', 'slide')
    await testInfo.attach('settings-transition-dark-en', {
      body: await window.screenshot({ path: testInfo.outputPath('settings-dark-en.png') }),
      contentType: 'image/png',
    })
    await window.keyboard.press('Escape')
    const slide = await sampleMotion(window, () =>
      window.locator(spaceButton('motion-space-1')).click(),
    )
    assertSlide(slide)
    assertSameLanding(fly, slide)
    const reverse = await sampleMotion(window, () =>
      window.locator(spaceButton('motion-space-0')).click(),
    )
    assertSlide(reverse)

    // Keyboard navigation uses the same node focus path as sidebar navigation.
    const key = process.platform === 'darwin' ? 'Meta+Alt' : 'Control+Alt'
    await window
      .locator('[data-id="motion-note-0"] .note-node')
      .click({ position: { x: 160, y: 100 } })
    const node = await sampleMotion(window, () => window.keyboard.press(`${key}+ArrowRight`))
    assertSlide(node)
    expect(node.samples.at(-1)!.x).toBeLessThan(-2000)
    const nodeReverse = await sampleMotion(window, () => window.keyboard.press(`${key}+ArrowLeft`))
    assertSlide(nodeReverse)

    const interrupted = await sampleMotion(window, async () => {
      await window.locator(spaceButton('motion-space-1')).click()
      // A frame-clock delay interrupts the first transition while it is still moving.
      await window.evaluate(
        () =>
          new Promise<void>(resolve => {
            const start = performance.now()
            const tick = (t: number): void => {
              if (t - start >= 60) {
                resolve()
              } else {
                requestAnimationFrame(tick)
              }
            }
            requestAnimationFrame(tick)
          }),
      )
      await window.locator(spaceButton('motion-space-0')).click()
    })
    assertSameLanding(reverse, interrupted)
    const manual = await sampleMotion(window, async () => {
      await window.locator(spaceButton('motion-space-1')).click()
      const canvas = await window.locator('.react-flow__pane').boundingBox()
      if (!canvas) {
        throw new Error('Canvas bounds missing')
      }
      await window.mouse.move(canvas.x + canvas.width - 50, canvas.y + 120)
      await window.mouse.wheel(0, 180)
    })
    expect(manual.samples.at(-1)!.zoom).toBeLessThan(0.99)
    const tail = manual.samples.slice(-5)
    expect(Math.max(...tail.map(s => s.x)) - Math.min(...tail.map(s => s.x))).toBeLessThan(1)

    const all = await sampleMotion(window, () => window.locator(spaceButton('all')).click())
    assertSlide(all)
    await window.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await sampleMotion(window, () =>
      window.locator(spaceButton('motion-space-0')).click(),
    )
    const unique = new Set(reduced.samples.map(s => `${s.x},${s.y},${s.zoom}`))
    expect(unique.size).toBeLessThanOrEqual(2)
    assertSameLanding(reverse, reduced)
    const measurements = {
      fly,
      slide,
      reverse,
      node,
      nodeReverse,
      interrupted,
      manual,
      all,
      reduced,
    }
    const measurementPath = testInfo.outputPath('motion-samples.json')
    await writeFile(measurementPath, JSON.stringify(measurements, null, 2))
    await testInfo.attach('viewport-motion-samples', {
      path: measurementPath,
      contentType: 'application/json',
    })
    expect(errors).toEqual([])
  } finally {
    await stopRecording?.()
    await electronApp.close()
  }
})
