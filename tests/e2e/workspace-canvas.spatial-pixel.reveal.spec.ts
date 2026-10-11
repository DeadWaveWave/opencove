import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import {
  installRevealCapture,
  installRevealProbe,
  maskedInputPoint,
  readRevealCaptures,
  readRevealPointer,
  readRevealRecords,
  sampleRevealCapture,
  settleRevealContentDiagnostic,
  type RevealRecord,
} from './workspace-canvas.spatial-pixel.reveal.probe'

async function createNode(page: Page, kind: 'note' | 'terminal') {
  await page.locator('.workspace-canvas .react-flow__pane').click({
    button: 'right',
    position: { x: 260, y: 180 },
  })
  const action = page.getByTestId(`workspace-context-new-${kind}`)
  await expect(action).toBeVisible()
  // The actual menu handler creates the node; avoid extra actionability frames after its commit.
  await action.evaluate(element => (element as HTMLElement).click())
}

async function seed(page: Page, kind: 'note' | 'terminal') {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await clearAndSeedWorkspace(page, [], {
    settings: {
      uiTheme: 'pixel',
      ...PIXEL_EFFECTS_ENABLED,
      language: 'en',
      standardWindowSizeBucket: kind === 'note' ? 'compact' : 'large',
    },
  })
  await expect(page.getByTestId('workspace-pixel-layer')).toHaveAttribute(
    'data-cove-pixel-motion',
    'enabled',
  )
}

function timing(record: RevealRecord) {
  return {
    id: record.id,
    kind: record.kind,
    width: record.firstRaf?.width,
    clockBasis: 'Controlled renderer clock; asynchronous content readiness is diagnostic only',
    contentObservation:
      'Observed until ready or 500ms after frame completion; null is not a frame failure',
    prepareToDOM: record.preparedAt === null ? null : record.dom.time - record.preparedAt,
    domToFrameVisible:
      record.firstFrameVisible === null ? null : record.firstFrameVisible.time - record.dom.time,
    firstRafToFrameVisible:
      record.firstFrameVisible === null || record.firstRaf === null
        ? null
        : record.firstFrameVisible.time - record.firstRaf.time,
    frameVisibleToFull:
      record.firstFrameVisible === null || record.fullAt === null
        ? null
        : record.fullAt - record.firstFrameVisible.time,
    prepareToContentReady:
      record.preparedAt === null || record.readyAt === null
        ? null
        : record.readyAt - record.preparedAt,
    contentReadyToFull:
      record.readyAt === null || record.fullAt === null ? null : record.fullAt - record.readyAt,
    contentVisibleToFull:
      record.firstVisible === null || record.fullAt === null
        ? null
        : record.fullAt - record.firstVisible.time,
    firstFrameVisibleFront: record.firstFrameVisible?.front,
    firstContentVisibleFront: record.firstVisible?.front,
  }
}

async function attachProbe(testInfo: TestInfo, name: string, value: unknown) {
  const outputPath = testInfo.outputPath(`${name}.json`)
  await writeFile(outputPath, JSON.stringify(value, null, 2))
  await testInfo.attach(name, {
    path: outputPath,
    contentType: 'application/json',
  })
}

async function attachPng(testInfo: TestInfo, name: string, encoded: string) {
  const outputPath = testInfo.outputPath(`${name}.png`)
  await writeFile(outputPath, Buffer.from(encoded, 'base64'))
  await testInfo.attach(name, { path: outputPath, contentType: 'image/png' })
}

test.describe('Workspace Canvas - Pixel Reveal First Paint', () => {
  test('starts on the first animation frames and gives note/terminal equal renderer-clock duration', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window: page } = await launchApp({ deviceScaleFactor: 1 })
    const records: RevealRecord[] = []
    try {
      // This is an animation-time contract. A busy CI compositor can defer native
      // RAF by hundreds of ms; the natural-clock motion suite covers real completion.
      await page.clock.install()
      const inspectKind = async (kind: 'note' | 'terminal') => {
        await seed(page, kind)
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await installRevealProbe(page)
        await createNode(page, kind)
        await expect(page.locator(`.react-flow__node:has(.${kind}-node)`)).toBeAttached()
        await page.clock.runFor(480)
        await expect
          .poll(
            async () => {
              const record = (await readRevealRecords(page))[0]
              return Boolean(record?.fullAt && record.firstFrameVisible)
            },
            { timeout: 6_000, intervals: [30, 50, 100] },
          )
          .toBe(true)
        await page.clock.resume()
        await settleRevealContentDiagnostic(page)
        const record = (await readRevealRecords(page))[0]!
        records.push(record)
        await attachProbe(testInfo, `${kind}-reveal-timing`, { summary: timing(record), record })
      }
      await inspectKind('note')
      await inspectKind('terminal')
      await attachProbe(testInfo, 'note-versus-terminal-animation-duration', records.map(timing))

      expect(records[1]!.firstRaf!.width).toBeGreaterThan(records[0]!.firstRaf!.width * 1.8)
      const durations = records.map(record => timing(record).frameVisibleToFull ?? 0)
      for (const record of records) {
        const summary = timing(record)
        expect(record.dom.masked, 'The node must be masked at its DOM insertion').toBe(true)
        expect(
          record.preparedAt,
          'Creation must prepare its mask before the DOM commit',
        ).not.toBeNull()
        expect(record.preparedAt!).toBeLessThanOrEqual(record.dom.time)
        const firstScheduledFrame = record.samples.find(sample => sample.assembling)
        expect(
          firstScheduledFrame,
          'The real effect scheduler must start the created node',
        ).toBeTruthy()
        expect(firstScheduledFrame!.front).toBeLessThan(0.01)
        // Decorative rendering is capped at 25Hz, separately from the probe's RAF.
        // The first scheduled effect frame starts at zero, then the next advances.
        expect(record.firstFrameVisible!.time - firstScheduledFrame!.time).toBeLessThanOrEqual(64)
        expect(
          record.firstFrameVisible?.front,
          `${record.kind} must begin at the start of its frame reveal`,
        ).toBeLessThan(0.2)
        expect(
          summary.domToFrameVisible ?? Infinity,
          `${record.kind} must not pause after its DOM frame exists`,
        ).toBeLessThanOrEqual(100)
        expect(
          summary.firstRafToFrameVisible ?? Infinity,
          `${record.kind} must not wait for content hydration before pixels advance`,
        ).toBeLessThanOrEqual(100)
      }
      for (const duration of durations) {
        expect(
          duration,
          'Frame-visible-to-complete duration must retain the 380ms reveal budget',
        ).toBeGreaterThanOrEqual(300)
        expect(duration).toBeLessThanOrEqual(470)
      }
      expect(Math.abs(durations[0]! - durations[1]!)).toBeLessThanOrEqual(70)
    } finally {
      await electronApp.close()
    }
  })

  for (const kind of ['note', 'terminal'] as const) {
    test(`keeps ${kind} first paint and partial reveal transparent in the real compositor`, async ({
      browserName,
    }, testInfo) => {
      void browserName
      const { electronApp, window: page } = await launchApp({ deviceScaleFactor: 1 })
      try {
        // Screenshots can stall native macOS composition for hundreds of ms. Keep
        // visual phases fixed while capturing; the separate test checks animation time.
        await page.clock.install()
        await installRevealCapture(electronApp)
        await seed(page, kind)
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await installRevealProbe(page, true)
        await createNode(page, kind)
        // Terminal creation crosses the PTY IPC boundary. Wait for its DOM commit
        // before advancing the frozen reveal clock, without waiting for content.
        await expect(page.locator(`.react-flow__node:has(.${kind}-node)`)).toBeAttached()
        await page.clock.runFor(16)
        await expect
          .poll(async () =>
            (await readRevealCaptures(electronApp)).some(
              capture => capture.phase === 'first-raf' && Boolean(capture.png),
            ),
          )
          .toBe(true)
        await page.clock.runFor(160)
        await expect
          .poll(async () =>
            (await readRevealCaptures(electronApp)).some(
              capture => capture.phase === 'partial' && Boolean(capture.png),
            ),
          )
          .toBe(true)
        const record = (await readRevealRecords(page))[0]!
        await expect
          .poll(
            async () =>
              (await readRevealCaptures(electronApp)).some(
                capture =>
                  capture.id === record.id && capture.phase === 'first-raf' && Boolean(capture.png),
              ),
            { timeout: 3_000 },
          )
          .toBe(true)
        const captures = await Promise.all(
          (await readRevealCaptures(electronApp))
            .filter(capture => capture.id === record.id)
            .map(capture => sampleRevealCapture(page, capture)),
        )
        await Promise.all(
          captures.flatMap(capture =>
            capture.png ? [attachPng(testInfo, `${kind}-${capture.phase}`, capture.png)] : [],
          ),
        )
        await attachProbe(
          testInfo,
          `${kind}-capture-pixels`,
          captures.map(({ png: _png, ...capture }) => capture),
        )
        expect(record.dom.masked, 'The rule must already match the first DOM insertion').toBe(true)
        expect(record.dom.maskImage).toContain('linear-gradient')
        expect(
          record.firstRaf?.masked,
          'The first renderer frame must not flash a complete node',
        ).toBe(true)
        expect(record.firstRaf?.front).toBeLessThan(0.2)
        const partial = captures.find(capture => capture.phase === 'partial')
        expect(
          partial,
          'The node frame must traverse a visible partial reveal without waiting for content readiness',
        ).toBeTruthy()
        expect(partial?.error).toBeUndefined()
        expect(
          partial?.pinkPixels ?? 0,
          'The real screenshot must show the underlay through the unrevealed right side',
        ).toBeGreaterThanOrEqual(18)
        await page.clock.runFor(500)
        await expect(page.locator(`.react-flow__node[data-id="${record.id}"]`)).toHaveCSS(
          'mask-image',
          'none',
        )
      } finally {
        await electronApp.close()
      }
    })
  }

  test('the masked right side receives a real pointer and reveals immediately before note/terminal input', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window: page } = await launchApp({ deviceScaleFactor: 1 })
    try {
      await page.clock.install()
      const inspectInput = async (kind: 'note' | 'terminal') => {
        await seed(page, kind)
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        await installRevealProbe(page)
        await createNode(page, kind)
        await expect(page.locator(`.react-flow__node:has(.${kind}-node)`)).toBeAttached()
        // Hold the real mask in its early phase while the actual mouse event crosses
        // the process boundary. No synthetic DOM event or runtime readiness override.
        // Advance at most 96ms: the original onset contract is <=100ms. Stop at
        // the first positive frame so IPC latency cannot consume the input phase.
        /* eslint-disable no-await-in-loop -- Each sample observes one controlled frame. */
        for (let frame = 0; frame < 6; frame++) {
          await page.clock.runFor(16)
          if ((await readRevealRecords(page))[0]?.firstFrameVisible) {
            break
          }
        }
        /* eslint-enable no-await-in-loop */
        expect((await readRevealRecords(page))[0]?.firstFrameVisible).toBeTruthy()
        const point = await maskedInputPoint(page)
        await page.mouse.click(point.x, point.y)
        const pointer = await readRevealPointer(page)
        const record = (await readRevealRecords(page))[0]!
        await attachProbe(testInfo, `${kind}-masked-input`, {
          point,
          pointer,
          summary: timing(record),
          record,
        })
        expect(pointer?.id, 'Masked pixels must retain the full real node hit region').toBe(
          point.id,
        )
        expect(
          pointer?.masked,
          'The physical pointer must arrive while the node is still masked',
        ).toBe(true)
        expect(pointer?.front).toBeLessThan(0.65)
        const node = page.locator(`.react-flow__node[data-id="${point.id}"]`)
        await expect(node).toHaveCSS('mask-image', 'none')
        await page.clock.resume()
        if (kind === 'note') {
          const textarea = node.getByTestId('note-node-textarea')
          await expect(textarea).toBeFocused()
          await page.keyboard.insertText('Immediate masked-region input')
          await expect(textarea).toHaveValue('Immediate masked-region input')
        } else {
          // Frame interaction reveals immediately; typing still respects the existing runtime readiness owner.
          await expect(node.locator('.terminal-node__terminal')).toHaveAttribute(
            'aria-busy',
            'false',
          )
          await expect(node.locator('.xterm-helper-textarea')).toBeFocused()
          const command =
            process.platform === 'win32'
              ? buildNodeEvalCommand("process.stdout.write(['MASK', 'INPUT'].join('_') + '\\n')")
              : "printf '%s_%s\\n' MASK INPUT"
          await page.keyboard.type(command)
          await page.keyboard.press('Enter')
          await expect(node).toContainText('MASK_INPUT')
        }
      }
      await inspectInput('note')
      await inspectInput('terminal')
    } finally {
      await electronApp.close()
    }
  })
})
