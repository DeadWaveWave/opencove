import { expect, test } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  seededWorkspaceId,
  viewStateStorageKey,
} from './workspace-canvas.helpers'

const nodeId = 'node-windows-raster-geometry'
const reportedDevicePixelRatio = 1.25
const reportedCanvasZoom = 1.06
const contextLossGlyphCount = 48
const contextLossGlyphRow = 'W'.repeat(contextLossGlyphCount)
const contextLossMarker = 'raster-context-loss-ok'
const fallbackGeometryGlyph = 'M'
const fallbackGeometryGlyphRow = fallbackGeometryGlyph.repeat(contextLossGlyphCount)
const fallbackGeometryMarker = 'raster-dom-geometry-forward'

test.describe('Workspace Canvas - Windows terminal raster geometry', () => {
  test.skip(process.platform !== 'win32', 'Windows terminal renderer regression')

  test('uses WebGL integer device cells at fractional display scale and canvas zoom', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp({
      windowMode: 'inactive',
      deviceScaleFactor: reportedDevicePixelRatio,
    })

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: nodeId,
            title: 'windows-raster-geometry',
            position: { x: 80, y: 70 },
            width: 915,
            height: 654,
          },
        ],
        {
          settings: {
            terminalFontFamily: 'Consolas',
            terminalFontSize: 13,
          },
        },
      )

      await window.evaluate(
        ({ key, workspaceId, zoom }) => {
          window.localStorage.setItem(
            key,
            JSON.stringify({
              activeWorkspaceId: workspaceId,
              workspaces: {
                [workspaceId]: {
                  viewport: { x: 0, y: 0, zoom },
                  isMinimapVisible: true,
                  activeSpaceId: null,
                },
              },
            }),
          )
        },
        {
          key: viewStateStorageKey,
          workspaceId: seededWorkspaceId,
          zoom: reportedCanvasZoom,
        },
      )
      await window.reload({ waitUntil: 'domcontentloaded' })

      await expect
        .poll(async () => (await readCanvasViewport(window)).zoom)
        .toBeCloseTo(reportedCanvasZoom, 2)

      const terminalSurface = window.locator(
        `.react-flow__node[data-id="${nodeId}"] .terminal-node__terminal`,
      )
      await expect(terminalSurface).toBeVisible()

      await terminalSurface.locator('.xterm').click()
      await window.keyboard.type(
        buildNodeEvalCommand(
          `for(let index=0;index<${contextLossGlyphCount};index+=1){process.stdout.write('\\u001b['+(31+index%6)+'mW')}process.stdout.write('\\u001b[0m\\n${contextLossMarker}\\n')`,
        ),
      )
      await window.keyboard.press('Enter')
      await expect
        .poll(async () => {
          return await window.evaluate(id => {
            const api = window.__opencoveTerminalSelectionTestApi
            api?.selectAll(id)
            const selection = api?.getSelection(id) ?? ''
            api?.clearSelection(id)
            return selection
          }, nodeId)
        })
        .toContain(contextLossMarker)

      await expect
        .poll(async () => await terminalSurface.getAttribute('data-cove-terminal-renderer'))
        .toBe('webgl')
      await expect
        .poll(async () =>
          Number(await terminalSurface.getAttribute('data-cove-terminal-raster-scale')),
        )
        .toBe(1.25)

      const projection = await window.evaluate(id => {
        const api = window.__opencoveTerminalSelectionTestApi
        return {
          platform: window.opencoveApi.meta?.platform ?? null,
          devicePixelRatio: window.devicePixelRatio,
          size: api?.getSize(id) ?? null,
          metrics: api?.getRenderMetrics(id) ?? null,
        }
      }, nodeId)

      expect(projection.platform).toBe('win32')
      expect(projection.devicePixelRatio).toBeCloseTo(reportedDevicePixelRatio, 2)
      expect(projection.size).not.toBeNull()
      expect(projection.metrics).not.toBeNull()

      const { size, metrics } = projection
      if (!size || !metrics) {
        throw new Error('terminal geometry projection unavailable')
      }

      const deviceCellWidth = (metrics.deviceCanvasWidth ?? 0) / size.cols
      const deviceCellHeight = (metrics.deviceCanvasHeight ?? 0) / size.rows
      expect(metrics.effectiveDpr).toBeCloseTo(reportedDevicePixelRatio, 2)
      expect(deviceCellWidth).toBeGreaterThanOrEqual(1)
      expect(deviceCellHeight).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(deviceCellWidth)).toBe(true)
      expect(Number.isInteger(deviceCellHeight)).toBe(true)
      expect(metrics.deviceCanvasWidth).toBe(size.cols * deviceCellWidth)
      expect(metrics.deviceCanvasHeight).toBe(size.rows * deviceCellHeight)

      const readContextLossDiagnostics = async () => {
        return await window.evaluate(
          ({ glyphRow, id, marker }) => {
            const api = window.__opencoveTerminalSelectionTestApi
            const renderMetrics = api?.getRenderMetrics(id) ?? null
            const bufferText = api?.getBufferText(id, marker) ?? null
            const glyphBufferText = api?.getBufferText(id, glyphRow) ?? null
            const terminalElement = document.querySelector(
              `.react-flow__node[data-id="${id}"] .terminal-node__terminal`,
            )
            const rowTextContentLengths = Array.from(
              terminalElement?.querySelectorAll('.xterm-rows > div') ?? [],
            ).map(row => row.textContent?.length ?? null)
            return {
              datasetRendererKind:
                terminalElement?.getAttribute('data-cove-terminal-renderer') ?? null,
              rendererConstructorName: renderMetrics?.rendererConstructorName ?? null,
              rendererDomRowElementCount: renderMetrics?.rendererDomRowElementCount ?? null,
              rendererHasDomRowContainer: renderMetrics?.rendererHasDomRowContainer ?? null,
              rendererHasDomRowFactory: renderMetrics?.rendererHasDomRowFactory ?? null,
              rendererHasWebglCanvas: renderMetrics?.rendererHasWebglCanvas ?? null,
              rendererStructuralKind: renderMetrics?.rendererStructuralKind ?? null,
              renderRowCount: renderMetrics?.renderRowCount ?? null,
              renderServicePaused: renderMetrics?.renderServicePaused ?? null,
              renderServiceNeedsFullRefresh: renderMetrics?.renderServiceNeedsFullRefresh ?? null,
              viewportY: renderMetrics?.viewportY ?? null,
              baseY: renderMetrics?.baseY ?? null,
              bufferLength: bufferText?.bufferLength ?? null,
              viewportBufferLines: bufferText?.viewportLines ?? null,
              markerAbsoluteLine: bufferText?.markerAbsoluteLine ?? null,
              glyphRowAbsoluteLine: glyphBufferText?.markerAbsoluteLine ?? null,
              rowTextContentLengths,
            }
          },
          { glyphRow: contextLossGlyphRow, id: nodeId, marker: contextLossMarker },
        )
      }
      const beforeContextLossDiagnostics = await readContextLossDiagnostics()
      expect(beforeContextLossDiagnostics.markerAbsoluteLine).not.toBeNull()
      expect(beforeContextLossDiagnostics.glyphRowAbsoluteLine).not.toBeNull()

      const contextLossPrevented = await terminalSurface
        .locator('.xterm-screen > canvas:not([class])')
        .evaluate(canvas => {
          const event = new Event('webglcontextlost', { cancelable: true })
          canvas.dispatchEvent(event)
          return event.defaultPrevented
        })
      expect(contextLossPrevented).toBe(true)

      await expect
        .poll(async () => await terminalSurface.getAttribute('data-cove-terminal-renderer'), {
          timeout: 10_000,
        })
        .toBe('dom')
      await expect
        .poll(async () => {
          const diagnostics = await readContextLossDiagnostics()
          return (
            diagnostics.glyphRowAbsoluteLine !== null && diagnostics.markerAbsoluteLine !== null
          )
        })
        .toBe(true)
      const afterContextLossDiagnostics = await readContextLossDiagnostics()
      const contextLossDiagnostics = {
        beforeContextLoss: beforeContextLossDiagnostics,
        afterContextLoss: afterContextLossDiagnostics,
      }
      const serializedContextLossDiagnostics = JSON.stringify(contextLossDiagnostics)
      process.stdout.write(`[windows-terminal-context-loss] ${serializedContextLossDiagnostics}\n`)
      await testInfo.attach('windows-terminal-context-loss', {
        body: Buffer.from(serializedContextLossDiagnostics),
        contentType: 'application/json',
      })
      expect(afterContextLossDiagnostics.markerAbsoluteLine).toBe(
        beforeContextLossDiagnostics.markerAbsoluteLine,
      )
      expect(afterContextLossDiagnostics.glyphRowAbsoluteLine).toBe(
        beforeContextLossDiagnostics.glyphRowAbsoluteLine,
      )

      await terminalSurface.locator('.xterm').click()
      await window.keyboard.type(
        buildNodeEvalCommand(
          `for(let index=0;index<${contextLossGlyphCount};index+=1){process.stdout.write('\\u001b['+(31+index%6)+'m${fallbackGeometryGlyph}')}process.stdout.write('\\u001b[0m\\n${fallbackGeometryMarker}\\n')`,
        ),
      )
      await window.keyboard.press('Enter')
      await expect(terminalSurface).toContainText(fallbackGeometryMarker)

      const fallbackProjection = await window.evaluate(
        ({ glyphRow, id }) => {
          const api = window.__opencoveTerminalSelectionTestApi
          const terminalElement = document.querySelector(
            `.react-flow__node[data-id="${id}"] .terminal-node__terminal`,
          )
          const screen = terminalElement?.querySelector('.xterm-screen')
          const glyphRowElement = Array.from(
            terminalElement?.querySelectorAll('.xterm-rows > div') ?? [],
          ).find(row => row.textContent?.includes(glyphRow))
          if (!(screen instanceof HTMLElement) || !(glyphRowElement instanceof HTMLElement)) {
            return null
          }

          const glyphSpans = Array.from(glyphRowElement.querySelectorAll(':scope > span'))
          const rowRect = glyphRowElement.getBoundingClientRect()
          const lastGlyphRect = glyphSpans.at(-1)?.getBoundingClientRect() ?? null
          return {
            glyphSpanCount: glyphSpans.length,
            glyphWidth: lastGlyphRect ? lastGlyphRect.right - rowRect.left : null,
            metrics: api?.getRenderMetrics(id) ?? null,
            rowWidth: rowRect.width,
            screenWidth: screen.getBoundingClientRect().width,
            size: api?.getSize(id) ?? null,
          }
        },
        { glyphRow: fallbackGeometryGlyphRow, id: nodeId },
      )
      expect(fallbackProjection).not.toBeNull()
      if (!fallbackProjection?.metrics || !fallbackProjection.size) {
        throw new Error('DOM fallback geometry projection unavailable')
      }

      const fallbackCellWidth = fallbackProjection.metrics.cssCellWidth
      const fallbackCanvasWidth = fallbackProjection.metrics.cssCanvasWidth
      expect(fallbackProjection.size).toEqual(size)
      expect(fallbackProjection.glyphSpanCount).toBe(contextLossGlyphCount)
      expect(fallbackCellWidth).not.toBeNull()
      expect(fallbackCanvasWidth).not.toBeNull()
      expect(fallbackProjection.glyphWidth).not.toBeNull()
      if (
        fallbackCellWidth === null ||
        fallbackCanvasWidth === null ||
        fallbackProjection.glyphWidth === null
      ) {
        throw new Error('DOM fallback glyph measurements unavailable')
      }

      expect(fallbackCanvasWidth).toBeCloseTo(size.cols * fallbackCellWidth, 8)
      expect(fallbackProjection.rowWidth).toBeCloseTo(fallbackCanvasWidth, 1)
      expect(fallbackProjection.screenWidth).toBeCloseTo(fallbackCanvasWidth, 1)
      expect(fallbackProjection.glyphWidth).toBeCloseTo(
        contextLossGlyphCount * fallbackCellWidth,
        1,
      )
    } finally {
      await electronApp.close()
    }
  })
})
