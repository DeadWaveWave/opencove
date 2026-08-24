import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
} from './workspace-canvas.helpers'
import { resolveTerminalEffectiveDevicePixelRatio } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/effectiveDevicePixelRatio'
import { resolveTerminalRasterScale } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalZoomRasterPolicy'

type TerminalRenderMetrics = {
  rendererKind: 'webgl' | 'dom' | null
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
  rasterScale: number | null
  size: { cols: number; rows: number } | null
}

async function readTerminalRenderMetrics(
  window: Parameters<typeof readCanvasViewport>[0],
  nodeId: string,
): Promise<TerminalRenderMetrics | null> {
  return await window.evaluate(targetNodeId => {
    const api = window.__opencoveTerminalSelectionTestApi
    const metrics = api?.getRenderMetrics?.(targetNodeId) ?? null
    if (!metrics) {
      return null
    }

    const terminalElement = document.querySelector(
      `.react-flow__node[data-id="${targetNodeId}"] .terminal-node__terminal`,
    )
    const rasterScaleAttribute = terminalElement?.getAttribute('data-cove-terminal-raster-scale')
    const rasterScale = Number(rasterScaleAttribute)
    const rendererAttribute = terminalElement?.getAttribute('data-cove-terminal-renderer')
    return {
      ...metrics,
      rendererKind:
        rendererAttribute === 'webgl' || rendererAttribute === 'dom' ? rendererAttribute : null,
      rasterScale: Number.isFinite(rasterScale) && rasterScale > 0 ? rasterScale : null,
      size: api?.getSize(targetNodeId) ?? null,
    }
  }, nodeId)
}

test.describe('Workspace Canvas - Terminal effective DPR', () => {
  test('keeps terminal DPR and layout native while changing raster scale on zoom', async () => {
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
      const expectedBaselineDpr = resolveTerminalEffectiveDevicePixelRatio({
        baseDevicePixelRatio: baselineWindowDpr,
        viewportZoom: 1,
      })
      const baselineViewport = await readCanvasViewport(window)
      const expectedBaselineRasterScale = resolveTerminalRasterScale({
        canvasZoom: baselineViewport.zoom,
        currentScale: 1,
      })

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
          effectiveDpr: expectedBaselineDpr,
          rasterScale: expectedBaselineRasterScale,
        })

      const baselineInstanceId = baselineMetrics?.instanceId ?? null
      expect(baselineMetrics?.deviceCanvasWidth).not.toBeNull()
      expect(baselineMetrics?.deviceCanvasHeight).not.toBeNull()
      expect(baselineMetrics?.size).not.toBeNull()

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
            const expectedEffectiveDpr = resolveTerminalEffectiveDevicePixelRatio({
              baseDevicePixelRatio: zoomedWindowDpr,
              viewportZoom: zoomedViewport.zoom,
            })
            const expectedRasterScale = resolveTerminalRasterScale({
              canvasZoom: zoomedViewport.zoom,
              currentScale: expectedBaselineRasterScale,
            })
            const rendererScaleSettled =
              zoomedMetrics?.rendererKind === 'webgl'
                ? zoomedMetrics.rasterScale === expectedRasterScale
                : zoomedMetrics?.rendererKind === 'dom' && zoomedMetrics.rasterScale === 1
            return (
              Math.abs((zoomedMetrics?.effectiveDpr ?? 0) - expectedEffectiveDpr) < 0.05 &&
              rendererScaleSettled
            )
          },
          { timeout: 15_000 },
        )
        .toBe(true)

      const expectedZoomedDpr = resolveTerminalEffectiveDevicePixelRatio({
        baseDevicePixelRatio: zoomedWindowDpr,
        viewportZoom: zoomedViewport.zoom,
      })
      const expectedZoomedRasterScale = resolveTerminalRasterScale({
        canvasZoom: zoomedViewport.zoom,
        currentScale: expectedBaselineRasterScale,
      })
      expect(zoomedMetrics?.effectiveDpr).toBeCloseTo(expectedZoomedDpr, 1)
      expect(zoomedMetrics?.size).toEqual(baselineMetrics?.size)
      expect(zoomedMetrics?.cssCanvasWidth).toBeCloseTo(baselineMetrics?.cssCanvasWidth ?? 0, 1)
      expect(zoomedMetrics?.cssCanvasHeight).toBeCloseTo(baselineMetrics?.cssCanvasHeight ?? 0, 1)

      const baselineSize = baselineMetrics?.size
      const zoomedSize = zoomedMetrics?.size
      if (!baselineMetrics || !zoomedMetrics || !baselineSize || !zoomedSize) {
        throw new Error('terminal raster projection unavailable')
      }
      const baselineDeviceCellWidth = (baselineMetrics.deviceCanvasWidth ?? 0) / baselineSize.cols
      const baselineDeviceCellHeight = (baselineMetrics.deviceCanvasHeight ?? 0) / baselineSize.rows
      const zoomedDeviceCellWidth = (zoomedMetrics.deviceCanvasWidth ?? 0) / zoomedSize.cols
      const zoomedDeviceCellHeight = (zoomedMetrics.deviceCanvasHeight ?? 0) / zoomedSize.rows
      if (zoomedMetrics.rendererKind === 'webgl') {
        expect(zoomedMetrics.rasterScale).toBe(expectedZoomedRasterScale)
        expect(Number.isInteger(zoomedDeviceCellWidth)).toBe(true)
        expect(Number.isInteger(zoomedDeviceCellHeight)).toBe(true)
        expect(zoomedDeviceCellWidth).toBe(
          Math.max(
            1,
            Math.round(
              (baselineDeviceCellWidth / expectedBaselineRasterScale) * expectedZoomedRasterScale,
            ),
          ),
        )
        expect(zoomedDeviceCellHeight).toBe(
          Math.max(
            1,
            Math.round(
              (baselineDeviceCellHeight / expectedBaselineRasterScale) * expectedZoomedRasterScale,
            ),
          ),
        )
        expect(zoomedMetrics.deviceCanvasWidth).toBe(zoomedSize.cols * zoomedDeviceCellWidth)
        expect(zoomedMetrics.deviceCanvasHeight).toBe(zoomedSize.rows * zoomedDeviceCellHeight)

        const changedLayoutDpr = zoomedWindowDpr * expectedZoomedRasterScale
        const rendererDprProjection = await window.evaluate(
          ({ nextDpr, nodeId }) =>
            window.__opencoveTerminalSelectionTestApi?.simulateRendererDevicePixelRatioChange(
              nodeId,
              nextDpr,
            ) ?? null,
          { nextDpr: changedLayoutDpr, nodeId: 'node-terminal-dpr' },
        )
        expect(rendererDprProjection).not.toBeNull()
        expect(rendererDprProjection?.rasterScale).toBe(expectedZoomedRasterScale)
        expect(rendererDprProjection?.devicePixelRatio).toBeCloseTo(
          changedLayoutDpr * expectedZoomedRasterScale,
          5,
        )
      } else {
        expect(zoomedMetrics.rendererKind).toBe('dom')
        expect(zoomedMetrics.rasterScale).toBe(1)
        expect(zoomedMetrics.cssCanvasWidth).toBe(
          Math.round((zoomedMetrics.deviceCanvasWidth ?? 0) / zoomedWindowDpr),
        )
        expect(zoomedMetrics.cssCanvasHeight).toBe(
          Math.round((zoomedMetrics.deviceCanvasHeight ?? 0) / zoomedWindowDpr),
        )
        if (baselineMetrics.rendererKind === 'dom') {
          expect(zoomedMetrics.deviceCanvasWidth).toBe(baselineMetrics.deviceCanvasWidth)
          expect(zoomedMetrics.deviceCanvasHeight).toBe(baselineMetrics.deviceCanvasHeight)
        }
      }

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

  test('preserves a user-scrolled terminal after zoom settles without returning to bottom', async () => {
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
      const expectedBaselineDpr = resolveTerminalEffectiveDevicePixelRatio({
        baseDevicePixelRatio: baselineWindowDpr,
        viewportZoom: 1,
      })

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
      expect(afterMetrics?.effectiveDpr).toBeCloseTo(expectedBaselineDpr, 2)
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
      const expectedZoomedDpr = resolveTerminalEffectiveDevicePixelRatio({
        baseDevicePixelRatio: windowDprAfterZoom,
        viewportZoom: zoomedViewport.zoom,
      })
      expect(afterMetrics?.effectiveDpr).toBeCloseTo(expectedZoomedDpr, 2)
      expect(afterMetrics?.instanceId).toBe(beforeMetrics?.instanceId ?? null)
    } finally {
      await electronApp.close()
    }
  })
})
