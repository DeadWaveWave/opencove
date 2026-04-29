import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
} from './workspace-canvas.helpers'

type TerminalRenderMetrics = {
  effectiveDpr: number | null
  deviceCanvasWidth: number | null
  deviceCanvasHeight: number | null
  cssCanvasWidth: number | null
  cssCanvasHeight: number | null
  baseY: number | null
  viewportY: number | null
  isUserScrolling: boolean | null
  dprDecision: string | null
  hookAtBottom: boolean | null
  hookViewportY: number | null
  hookBaseY: number | null
  instanceId: number | null
}

async function readTerminalRenderMetrics(
  window: Parameters<typeof readCanvasViewport>[0],
  nodeId: string,
): Promise<TerminalRenderMetrics | null> {
  return await window.evaluate(targetNodeId => {
    return window.__opencoveTerminalSelectionTestApi?.getRenderMetrics?.(targetNodeId) ?? null
  }, nodeId)
}

test.describe('Workspace Canvas - Terminal effective DPR', () => {
  test('raises terminal backing resolution on zoom without remounting or losing focus', async () => {
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-terminal-dpr',
          title: 'terminal-dpr',
          position: { x: 160, y: 140 },
          width: 560,
          height: 340,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      const xtermHandle = await xterm.elementHandle()
      expect(xtermHandle).not.toBeNull()

      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(
        buildNodeEvalCommand(
          "process.stdout.write('\\u001b[2J\\u001b[Hterminal-dpr-ready\\n');setInterval(()=>{},1000)",
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('terminal-dpr-ready')

      const baselineWindowDpr = await window.evaluate(() => window.devicePixelRatio)
      expect(baselineWindowDpr).toBeGreaterThan(0)

      let baselineMetrics: TerminalRenderMetrics | null = null
      await expect
        .poll(
          async () => {
            baselineMetrics = await readTerminalRenderMetrics(window, 'node-terminal-dpr')
            return baselineMetrics
          },
          { timeout: 15_000 },
        )
        .toMatchObject({
          effectiveDpr: baselineWindowDpr,
        })

      const baselineInstanceId = baselineMetrics?.instanceId ?? null
      expect(baselineMetrics?.deviceCanvasWidth).not.toBeNull()
      expect(baselineMetrics?.deviceCanvasHeight).not.toBeNull()

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()

      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeGreaterThan(1.01)
      const zoomedWindowDpr = await window.evaluate(() => window.devicePixelRatio)
      expect(zoomedWindowDpr).toBeCloseTo(baselineWindowDpr, 5)

      let zoomedMetrics: TerminalRenderMetrics | null = null
      let zoomedViewport = await readCanvasViewport(window)
      await expect
        .poll(
          async () => {
            zoomedViewport = await readCanvasViewport(window)
            zoomedMetrics = await readTerminalRenderMetrics(window, 'node-terminal-dpr')
            const effectiveDpr = zoomedMetrics?.effectiveDpr ?? 0
            const expectedEffectiveDpr = baselineWindowDpr * zoomedViewport.zoom
            return (
              zoomedMetrics?.dprDecision === 'applied:viewport-settled' &&
              Math.abs(effectiveDpr - expectedEffectiveDpr) < 0.05
            )
          },
          { timeout: 15_000 },
        )
        .toBe(true)

      const expectedZoomedDpr = baselineWindowDpr * zoomedViewport.zoom
      expect(zoomedMetrics?.effectiveDpr).toBeCloseTo(expectedZoomedDpr, 1)
      expect(zoomedMetrics?.deviceCanvasWidth ?? 0).toBeGreaterThan(
        baselineMetrics?.deviceCanvasWidth ?? 0,
      )
      expect(zoomedMetrics?.deviceCanvasHeight ?? 0).toBeGreaterThan(
        baselineMetrics?.deviceCanvasHeight ?? 0,
      )
      expect(zoomedMetrics?.cssCanvasWidth).toBeCloseTo(baselineMetrics?.cssCanvasWidth ?? 0, 1)
      expect(zoomedMetrics?.cssCanvasHeight).toBeCloseTo(baselineMetrics?.cssCanvasHeight ?? 0, 1)
      expect(zoomedMetrics?.instanceId).toBe(baselineInstanceId)
      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()

      if (xtermHandle) {
        const isOriginalXtermConnected = await window.evaluate(
          handle => handle?.isConnected ?? false,
          xtermHandle,
        )
        expect(isOriginalXtermConnected).toBe(true)
      }
    } finally {
      await electronApp.close()
    }
  })

  test('sharpens a user-scrolled terminal after zoom settles without returning to bottom', async () => {
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-terminal-zoom-scroll',
          title: 'terminal-zoom-scroll',
          position: { x: 160, y: 140 },
          width: 560,
          height: 340,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()
      const xtermHandle = await xterm.elementHandle()
      expect(xtermHandle).not.toBeNull()

      await xterm.click()
      await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
      await window.keyboard.type(
        buildNodeEvalCommand(
          'let liveCounter=0;for(let i=0;i<260;i+=1){console.log(`ZOOM_SCROLL_${i}`)};setInterval(()=>{console.log(`ZOOM_LIVE_${liveCounter++}`)},60)',
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('ZOOM_SCROLL_259')
      const baselineWindowDpr = await window.evaluate(() => window.devicePixelRatio)

      await terminal.hover()
      await window.mouse.wheel(0, -1600)
      await window.waitForTimeout(150)

      let beforeMetrics: TerminalRenderMetrics | null = null
      await expect
        .poll(
          async () => {
            beforeMetrics = await readTerminalRenderMetrics(window, 'node-terminal-zoom-scroll')
            return beforeMetrics?.viewportY ?? null
          },
          { timeout: 10_000 },
        )
        .not.toBeNull()

      // eslint-disable-next-line no-console
      console.log('[terminal-dpr] before zoom scroll metrics', {
        ...beforeMetrics,
        dprDecision: beforeMetrics?.dprDecision ?? null,
        hookAtBottom: beforeMetrics?.hookAtBottom ?? null,
        hookViewportY: beforeMetrics?.hookViewportY ?? null,
        hookBaseY: beforeMetrics?.hookBaseY ?? null,
      })
      expect(beforeMetrics?.viewportY).toBeGreaterThan(0)
      expect(beforeMetrics?.baseY).not.toBeNull()
      expect(beforeMetrics?.viewportY).toBeLessThan(beforeMetrics?.baseY ?? 0)

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await zoomInButton.click()
      await expect
        .poll(async () => {
          return (await readCanvasViewport(window)).zoom
        })
        .toBeGreaterThan(1.01)
      const zoomedViewport = await readCanvasViewport(window)
      await window.waitForTimeout(600)
      await expect(terminal).toContainText('ZOOM_LIVE_')

      const windowDprAfterZoom = await window.evaluate(() => window.devicePixelRatio)
      // eslint-disable-next-line no-console
      console.log('[terminal-dpr] window.devicePixelRatio after zoom', windowDprAfterZoom)

      const afterMetrics = await readTerminalRenderMetrics(window, 'node-terminal-zoom-scroll')
      if (xtermHandle) {
        const isOriginalXtermConnected = await window.evaluate(
          handle => handle.isConnected,
          xtermHandle,
        )
        // eslint-disable-next-line no-console
        console.log('[terminal-dpr] original xterm still connected', isOriginalXtermConnected)
      }

      // eslint-disable-next-line no-console
      console.log('[terminal-dpr] after zoom scroll metrics', {
        ...afterMetrics,
        dprDecision: afterMetrics?.dprDecision ?? null,
        hookAtBottom: afterMetrics?.hookAtBottom ?? null,
        hookViewportY: afterMetrics?.hookViewportY ?? null,
        hookBaseY: afterMetrics?.hookBaseY ?? null,
      })
      expect(afterMetrics?.effectiveDpr ?? 0).toBeGreaterThan(baselineWindowDpr)
      expect(afterMetrics?.viewportY).not.toBeNull()
      expect(afterMetrics?.baseY).not.toBeNull()
      expect(afterMetrics?.viewportY).toBeLessThan(afterMetrics?.baseY ?? 0)
      expect(
        Math.abs((afterMetrics?.viewportY ?? 0) - (beforeMetrics?.viewportY ?? 0)),
      ).toBeLessThanOrEqual(1)
      expect((afterMetrics?.baseY ?? 0) - (afterMetrics?.viewportY ?? 0)).toBeGreaterThanOrEqual(
        (beforeMetrics?.baseY ?? 0) - (beforeMetrics?.viewportY ?? 0),
      )
      expect(afterMetrics?.cssCanvasWidth).toBeCloseTo(beforeMetrics?.cssCanvasWidth ?? 0, 1)
      expect(afterMetrics?.cssCanvasHeight).toBeCloseTo(beforeMetrics?.cssCanvasHeight ?? 0, 1)
      expect(afterMetrics?.effectiveDpr).toBeCloseTo(baselineWindowDpr * zoomedViewport.zoom, 2)
      expect(afterMetrics?.instanceId).toBe(beforeMetrics?.instanceId ?? null)
    } finally {
      await electronApp.close()
    }
  })
})
