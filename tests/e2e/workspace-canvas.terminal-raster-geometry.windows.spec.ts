import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  seededWorkspaceId,
  viewStateStorageKey,
} from './workspace-canvas.helpers'

const nodeId = 'node-windows-raster-geometry'
const reportedDevicePixelRatio = 1.25
const reportedCanvasZoom = 1.06

test.describe('Workspace Canvas - Windows terminal raster geometry', () => {
  test.skip(process.platform !== 'win32', 'Windows terminal renderer regression')

  test('uses WebGL integer device cells at fractional display scale and canvas zoom', async () => {
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
    } finally {
      await electronApp.close()
    }
  })
})
