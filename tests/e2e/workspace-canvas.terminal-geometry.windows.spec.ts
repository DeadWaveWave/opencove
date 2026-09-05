import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readLocatorClientRect,
} from './workspace-canvas.helpers'

const nodeId = 'windows-terminal-geometry'

async function drag(window: Page, resizer: Locator, x: number, y: number) {
  const rect = await readLocatorClientRect(resizer)
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  await window.mouse.move(start.x + x, start.y + y, { steps: 12 })
  await window.mouse.up()
}

async function assertGrids(window: Page, sessionId: string, phase: string) {
  await expect
    .poll(
      () =>
        window.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const size = api?.getSize(id)
          const proposed = api?.getProposedGeometry(id)
          return !!size && !!proposed && size.cols === proposed.cols && size.rows === proposed.rows
        }, nodeId),
      { timeout: 15_000 },
    )
    .toBe(true)
  const marker = `WIN_SIZE_${phase}_${Date.now().toString(36)}`
  // Node's TTY getter independently reads the attached Windows Console, not node-pty's JS cache.
  const command = buildNodeEvalCommand(
    `process.stdout.write('${marker}:'+process.stdout.columns+'x'+process.stdout.rows+'\\n')`,
  )
  await window.evaluate(
    async payload => {
      await window.opencoveApi.pty.write({
        sessionId: payload.sessionId,
        data: `${payload.command}\r`,
      })
    },
    { sessionId, command },
  )
  await expect
    .poll(
      () =>
        window.evaluate(
          async payload => {
            const size = window.__opencoveTerminalSelectionTestApi?.getSize(payload.nodeId)
            const snapshot = await window.opencoveApi.pty.presentationSnapshot({
              sessionId: payload.sessionId,
            })
            const match = snapshot.serializedScreen.match(
              new RegExp(`${payload.marker}:(\\d+)x(\\d+)`),
            )
            return (
              !!size &&
              !!match &&
              Number(match[1]) === size.cols &&
              Number(match[2]) === size.rows &&
              snapshot.cols === size.cols &&
              snapshot.rows === size.rows
            )
          },
          { sessionId, marker, nodeId },
        ),
      { timeout: 15_000 },
    )
    .toBe(true)
  return (await window.evaluate(
    id => window.__opencoveTerminalSelectionTestApi!.getSize(id),
    nodeId,
  ))!
}

test.describe('Windows terminal window fitting', () => {
  test.skip(process.platform !== 'win32', 'Windows Console geometry')

  for (const runtime of ['desktop', 'worker'] as const) {
    test(`${runtime}: fits at 150% DPR with calibration off through resize and reattach`, async () => {
      const testInfo = test.info()
      const { electronApp, window } = await launchApp({
        deviceScaleFactor: 1.5,
        env: { OPENCOVE_WORKER_CLIENT: runtime === 'worker' ? '1' : '0' },
      })
      try {
        await clearAndSeedWorkspace(
          window,
          [{ id: nodeId, title: nodeId, position: { x: 80, y: 80 }, width: 520, height: 340 }],
          {
            settings: {
              terminalFontSize: 13,
              terminalDisplayAutoReferenceEnabled: false,
              terminalDisplayCalibrationCompensationEnabled: false,
            },
          },
        )
        const terminal = window.locator('.terminal-node').first()
        await expect(terminal.locator('.xterm')).toBeVisible()
        await expect
          .poll(() =>
            window.evaluate(
              id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id),
              nodeId,
            ),
          )
          .toBeTruthy()
        const sessionId = (await window.evaluate(
          id => window.__opencoveTerminalSelectionTestApi!.getRuntimeSessionId(id),
          nodeId,
        ))!
        expect(await window.evaluate(() => window.devicePixelRatio)).toBe(1.5)
        const initial = await assertGrids(window, sessionId, 'initial')
        await expect
          .poll(() =>
            window.evaluate(
              id =>
                window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)
                  ?.rendererStructuralKind,
              nodeId,
            ),
          )
          .toBe('webgl')
        await drag(window, terminal.getByTestId('terminal-resizer-right'), 160, 0)
        const expanded = await assertGrids(window, sessionId, 'expanded')
        expect(expanded.cols).toBeGreaterThan(initial.cols)
        await drag(window, terminal.getByTestId('terminal-resizer-right'), -210, 0)
        await drag(window, terminal.getByTestId('terminal-resizer-bottom'), 0, -60)
        const shrunk = await assertGrids(window, sessionId, 'shrunk')
        expect(shrunk.cols).toBeLessThan(initial.cols)
        expect(shrunk.rows).toBeLessThan(initial.rows)

        await terminal.locator('.xterm').click()
        await window.keyboard.type(
          buildNodeEvalCommand("process.stdout.write('LONG_'+ 'x'.repeat(240)+'_VISIBLE_END\\n')"),
        )
        await window.keyboard.press('Enter')
        await expect
          .poll(() =>
            window.evaluate(id => {
              return window.__opencoveTerminalSelectionTestApi?.getBufferText(id, 'VISIBLE_END')
                ?.markerAbsoluteLine
            }, nodeId),
          )
          .toBeGreaterThanOrEqual(0)
        await expect(terminal.getByTestId('terminal-geometry-feedback')).toHaveCount(0)
        const width = await terminal
          .locator('.terminal-node__terminal')
          .evaluate(el => el.clientWidth)
        const metrics = await window.evaluate(
          id => window.__opencoveTerminalSelectionTestApi!.getRenderMetrics(id),
          nodeId,
        )
        expect(metrics!.cssCanvasWidth!).toBeLessThanOrEqual(width)
        await testInfo.attach(`${runtime}-150pct-shrink`, {
          body: await terminal.screenshot({
            path: testInfo.outputPath(`${runtime}-150pct-shrink.png`),
          }),
          contentType: 'image/png',
        })

        await window.reload({ waitUntil: 'domcontentloaded' })
        await expect(terminal.locator('.xterm')).toBeVisible()
        await expect
          .poll(() =>
            window.evaluate(
              id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id),
              nodeId,
            ),
          )
          .toBe(sessionId)
        await assertGrids(window, sessionId, 'reattached')
        await expect(terminal.getByTestId('terminal-geometry-feedback')).toHaveCount(0)
      } finally {
        await electronApp.close()
      }
    })
  }
})
