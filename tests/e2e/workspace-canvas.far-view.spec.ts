import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const TERMINAL = 'far-view-terminal'
const NOTE = 'far-view-note'

async function setZoom(window: Page, zoom: number) {
  expect(
    await window.evaluate(next => window.__opencoveWorkspaceCanvasTestApi?.setZoom(next), zoom),
  ).toBe(true)
}

/** The terminal's runtime identity and both ends of its size: xterm in the renderer, PTY in main. */
async function readTerminal(window: Page) {
  return await window.evaluate(async id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const sessionId = api?.getRuntimeSessionId(id) ?? null
    const pty = sessionId ? await window.opencoveApi.pty.presentationSnapshot({ sessionId }) : null
    return {
      sessionId,
      instanceId: api?.getRenderMetrics(id)?.instanceId ?? null,
      size: api?.getSize(id) ?? null,
      proposed: api?.getProposedGeometry(id) ?? null,
      pty: pty ? { cols: pty.cols, rows: pty.rows } : null,
    }
  }, TERMINAL)
}

const lodOf = (window: Page) =>
  window.locator('.workspace-canvas').evaluate(canvas => canvas.getAttribute('data-cove-lod'))

test('far view draws windows as tiles and leaves running terminals untouched', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(
      window,
      [
        { id: TERMINAL, title: 'Build logs', position: { x: 0, y: 0 }, width: 460, height: 300 },
        {
          id: NOTE,
          title: 'Release notes',
          kind: 'note',
          position: { x: 560, y: 0 },
          width: 360,
          height: 300,
          labelColorOverride: 'orange',
          task: { text: 'Release notes' },
        },
      ],
      { settings: { uiTheme: 'dark', canvasFarViewEnabled: true } },
    )
    // Settled: xterm fits its window and the PTY has been told, twice in a row.
    let before = await readTerminal(window)
    await expect
      .poll(async () => {
        const previous = before
        before = await readTerminal(window)
        const settled =
          before.pty !== null &&
          JSON.stringify(before.size) === JSON.stringify(before.proposed) &&
          JSON.stringify(before.pty) === JSON.stringify(before.size)
        return settled && JSON.stringify(previous) === JSON.stringify(before)
      })
      .toBe(true)
    expect(await lodOf(window)).toBe('near')
    await expect(window.getByTestId('workspace-far-view')).toHaveCount(0)

    await setZoom(window, 0.2)
    await expect.poll(() => lodOf(window)).toBe('far')
    const terminalTile = window.getByTestId(`workspace-far-tile-${TERMINAL}`)
    await expect(terminalTile).toHaveAttribute('data-cove-kind', 'shell')
    await expect(terminalTile).toContainText('Build logs')
    const noteTile = window.getByTestId(`workspace-far-tile-${NOTE}`)
    await expect(noteTile).toHaveAttribute('data-cove-kind', 'knowledge')
    await expect(noteTile).toHaveAttribute('data-cove-label-color', 'orange')
    const runtime = window.locator(
      `.react-flow__node[data-id="${TERMINAL}"] .cove-node-presentation__runtime`,
    )
    await expect(runtime).toHaveCSS('content-visibility', 'hidden')
    // The title stays legible on screen: 15px, capped by the tile (12% of a 460px window).
    const title = await terminalTile
      .locator('.workspace-far-tile__title')
      .evaluate(element => element.getBoundingClientRect().height)
    expect(title).toBeGreaterThan(9)
    expect(title).toBeLessThan(40)
    expect(await readTerminal(window)).toEqual(before)

    // Hysteresis: far until above 28%.
    await setZoom(window, 0.27)
    expect(await lodOf(window)).toBe('far')
    await setZoom(window, 0.3)
    await expect.poll(() => lodOf(window)).toBe('near')
    await expect(window.getByTestId('workspace-far-view')).toHaveCount(0)
    await expect(runtime).toHaveCSS('content-visibility', 'visible')

    // eslint-disable-next-line no-await-in-loop -- each zoom step must land before the next.
    for (const zoom of [0.1, 2, 0.1, 2, 0.1, 2, 1]) {
      // eslint-disable-next-line no-await-in-loop
      await setZoom(window, zoom)
    }
    expect(await readTerminal(window)).toEqual(before)

    // Settings → Appearance → Far View off keeps windows themselves at any zoom.
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-appearance').click()
    const toggle = window.getByTestId('settings-canvas-far-view')
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await window.getByTestId('settings-panel-close').click()
    await setZoom(window, 0.15)
    expect(await lodOf(window)).toBe('near')
    await expect(window.getByTestId('workspace-far-view')).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})
