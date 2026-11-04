import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test, type Page } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readWorkspaceViewState,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { hoverCanvasPane } from './workspace-canvas.zoom.helpers'
import {
  closeWebsiteTestServer,
  enableWebsiteWindowPolicy,
} from './workspace-canvas.website-window.shared'

const TERMINAL = 'far-view-terminal'
const NOTE = 'far-view-note'

async function setZoom(window: Page, zoom: number) {
  expect(
    await window.evaluate(next => window.__opencoveWorkspaceCanvasTestApi?.setZoom(next), zoom),
  ).toBe(true)
}

async function continuousWheelGesture(window: Page, deltaY: number) {
  // Keep input arrival independent of browser acknowledgments: snapshot capture can delay a
  // wheel response beyond the gesture-end debounce even though a user keeps turning the wheel.
  await Promise.all(
    Array.from({ length: 15 }, async (_, step) => {
      await new Promise(resolve => setTimeout(resolve, step * 20))
      await window.mouse.wheel(0, deltaY)
    }),
  )
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

    // A modified click keeps selecting in far view; a plain click flies to the window.
    await setZoom(window, 0.2)
    await expect.poll(() => lodOf(window)).toBe('far')
    const center = async (locator: typeof noteTile) => {
      const box = (await locator.boundingBox())!
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const notePoint = await center(noteTile)
    await window.keyboard.down('Shift')
    await window.mouse.click(notePoint.x, notePoint.y)
    await window.keyboard.up('Shift')
    expect(await lodOf(window)).toBe('far')
    // Dragging a tile moves its window: 60 screen pixels are 300 canvas pixels at 20%, less any
    // magnetic snapping to the neighbouring window.
    const dragFrom = await center(noteTile)
    const noteWindow = window.locator(`.react-flow__node[data-id="${NOTE}"]`)
    const readNoteX = () =>
      noteWindow.evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)
    const noteX = await readNoteX()
    await window.mouse.move(dragFrom.x, dragFrom.y)
    await window.mouse.down()
    await window.mouse.move(dragFrom.x + 30, dragFrom.y, { steps: 4 })
    await window.mouse.move(dragFrom.x + 60, dragFrom.y, { steps: 4 })
    await window.mouse.up()
    await expect.poll(async () => (await readNoteX()) - noteX).toBeGreaterThan(200)
    expect(await lodOf(window)).toBe('far')

    // Right-clicking a tile opens its window's menu.
    await window.mouse.click(1, 1)
    const terminalPoint = await center(terminalTile)
    await window.mouse.click(terminalPoint.x, terminalPoint.y, { button: 'right' })
    await expect(window.getByTestId('workspace-selection-label-color')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('workspace-selection-label-color')).toHaveCount(0)
    expect(await lodOf(window)).toBe('far')

    await window.mouse.click(terminalPoint.x, terminalPoint.y)
    await expect.poll(() => lodOf(window)).toBe('near')
    const terminalWindow = window.locator(`.react-flow__node[data-id="${TERMINAL}"]`)
    await expect
      .poll(async () => {
        const canvas = (await window.locator('.workspace-canvas .react-flow').boundingBox())!
        const box = (await terminalWindow.boundingBox())!
        // Landed close enough to read: at least 60% zoom, so the window is 276px or wider.
        return (
          box.width >= 460 * 0.6 - 1 &&
          box.x >= canvas.x &&
          box.x + box.width <= canvas.x + canvas.width
        )
      })
      .toBe(true)
    expect(await readTerminal(window)).toEqual(before)

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

test('zoom steps and a continuous wheel gesture do not commit window headers', async () => {
  const testInfo = test.info()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' })
    response.end('<!doctype html><body>Zero window commits</body>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing server address')
  }
  const { electronApp, window } = await launchApp()
  const counts = () =>
    window.evaluate(() => window.__opencoveWorkspaceCanvasTestApi!.getWindowCommitCounts())
  const reset = () =>
    window.evaluate(() => window.__opencoveWorkspaceCanvasTestApi!.resetWindowCommitCounts())
  // Allow effects, viewport persistence and interaction-settle timers to finish before reading.
  const settle = () => window.waitForTimeout(600)
  try {
    await clearAndSeedWorkspace(
      window,
      [
        { id: TERMINAL, title: 'Shell', position: { x: 0, y: 0 }, width: 460, height: 300 },
        {
          id: NOTE,
          title: 'Note',
          kind: 'note',
          position: { x: 500, y: 0 },
          width: 360,
          height: 300,
          task: { text: 'Note' },
        },
        {
          id: 'zoom-agent',
          title: 'Agent',
          kind: 'agent',
          status: 'stopped',
          position: { x: 0, y: 350 },
          width: 460,
          height: 300,
        },
        {
          id: 'zoom-task',
          title: 'Task',
          kind: 'task',
          position: { x: 500, y: 350 },
          width: 360,
          height: 300,
          task: {
            requirement: 'Task',
            status: 'todo',
            linkedAgentNodeId: null,
            lastRunAt: null,
            autoGeneratedTitle: false,
          },
        },
        {
          id: 'zoom-website',
          title: 'Website',
          kind: 'website',
          position: { x: 300, y: 100 },
          width: 400,
          height: 300,
          task: {
            url: `http://127.0.0.1:${address.port}`,
            pinned: false,
            sessionMode: 'shared',
            profileId: null,
          },
        },
      ],
      {
        settings: {
          canvasFarViewEnabled: true,
          canvasInputMode: 'mouse',
          canvasWheelBehavior: 'zoom',
          websiteWindowPolicy: { enabled: true },
        },
      },
    )
    await expect(window.locator('.website-node')).toBeVisible()
    await expect.poll(async () => (await readTerminal(window)).instanceId).not.toBeNull()
    await expect(
      window.locator(`[data-id="${TERMINAL}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false')
    const readOwnState = () =>
      window.evaluate(async id => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        const state = JSON.parse(raw ?? '{}') as {
          workspaces?: Array<{ nodes?: Array<{ id: string; scrollback?: string }> }>
        }
        return state.workspaces?.[0]?.nodes?.find(node => node.id === id)
      }, TERMINAL)
    // Keep a real PTY alive with known, idle output. A partial shell startup flush is not a
    // readiness signal: later prompt chunks would legitimately change the window's own data.
    const sessionId = (await readTerminal(window)).sessionId
    if (!sessionId) {
      throw new Error('Missing terminal session')
    }
    await window.evaluate(payload => window.opencoveApi.pty.write(payload), {
      sessionId,
      data: `${buildNodeEvalCommand("process.stdout.write('ZOOM_FIXTURE_IDLE\\n');setInterval(()=>{},1000)")}\r`,
    })
    await expect.poll(async () => (await readOwnState())?.scrollback).toContain('ZOOM_FIXTURE_IDLE')
    await settle()
    // Prove all five header families are mounted and the probe is live before resetting it.
    expect(await counts()).toEqual(
      expect.objectContaining({
        shell: expect.any(Number),
        ai: expect.any(Number),
        plan: expect.any(Number),
        knowledge: expect.any(Number),
        media: expect.any(Number),
      }),
    )
    const ownStateBefore = await readOwnState()
    const terminalBefore = await readTerminal(window)
    await reset()
    for (const zoom of [
      0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7,
    ]) {
      // eslint-disable-next-line no-await-in-loop -- each step must commit before measuring the next.
      await setZoom(window, zoom)
    }
    await settle()
    const stepped = await counts()
    // eslint-disable-next-line no-console -- Keep commit counts in the E2E evidence.
    console.log('window commits: stepped', stepped)
    expect.soft(stepped).toEqual({})
    expect(await readOwnState()).toEqual(ownStateBefore)
    expect(await readTerminal(window)).toEqual(terminalBefore)

    await hoverCanvasPane(window)
    await reset()
    const wheelBefore = await readCanvasViewport(window)
    // Fixed mouse mode + zoom wheel behavior needs no modifier. Each input lands on a real pane
    // hit; gaps stay below the gesture-end debounce, unlike fifteen separate setZoom calls.
    await continuousWheelGesture(window, 12)
    const duringWheel = await counts()
    await settle()
    const wheel = await counts()
    // eslint-disable-next-line no-console -- Keep commit counts in the E2E evidence.
    console.log('window commits: wheel', { duringWheel, settled: wheel })
    expect.soft(duringWheel).toEqual({})
    expect.soft(wheel).toEqual({})
    expect(await readOwnState()).toEqual(ownStateBefore)
    const wheelAfter = await readCanvasViewport(window)
    expect(wheelAfter.zoom).toBeLessThan(wheelBefore.zoom - 0.05)
    await expect
      .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.viewport.zoom)
      .toBeCloseTo(wheelAfter.zoom, 3)
    expect(await readTerminal(window)).toEqual(terminalBefore)

    // An active native website deliberately swaps to a snapshot once, and back once. Its header
    // may commit at these real presentation transitions, never at every zoom frame.
    await setZoom(window, 0.7)
    await enableWebsiteWindowPolicy(window)
    await window.locator('.website-node__viewport').click({ position: { x: 50, y: 50 } })
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].__opencoveWebsiteWindowManager?.runtimeByNodeId.get(
              'zoom-website',
            )?.snapshotDocumentReady,
        ),
      )
      .toBe(true)
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => {
          const runtime =
            BrowserWindow.getAllWindows()[0].__opencoveWebsiteWindowManager?.runtimeByNodeId.get(
              'zoom-website',
            )
          return runtime?.lifecycle === 'active' && Boolean(runtime.snapshotDataUrl)
        }),
      )
      .toBe(true)
    await hoverCanvasPane(window)
    await settle()
    await reset()
    await continuousWheelGesture(window, 8)
    const activeDuring = await counts()
    await settle()
    const activeAfter = await counts()
    // eslint-disable-next-line no-console -- Keep commit counts in the E2E evidence.
    console.log('window commits: active website', { activeDuring, activeAfter })
    const { media: duringMedia = 0, ...duringOthers } = activeDuring
    const { media: afterMedia = 0, ...afterOthers } = activeAfter
    expect.soft(duringOthers).toEqual({})
    expect.soft(afterOthers).toEqual({})
    expect.soft(duringMedia).toBe(1)
    expect.soft(afterMedia).toBe(2)
    await expect(window.locator('.website-node__snapshot')).toHaveCount(0)
    const finalZoom = (await readCanvasViewport(window)).zoom
    const body = (await window.locator('.website-node__viewport').boundingBox())!
    const dpr = await window.evaluate(() => window.devicePixelRatio)
    // Native host edges round outward to device pixels, preserving the complete browser image.
    const left = Math.floor(body.x * dpr)
    const top = Math.floor(body.y * dpr)
    const expectedBounds = {
      x: left / dpr,
      y: top / dpr,
      width: (Math.ceil((body.x + body.width) * dpr) - left) / dpr,
      height: (Math.ceil((body.y + body.height) * dpr) - top) / dpr,
    }
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => {
          const runtime =
            BrowserWindow.getAllWindows()[0].__opencoveWebsiteWindowManager?.runtimeByNodeId.get(
              'zoom-website',
            )
          return runtime?.bounds
            ? { bounds: runtime.bounds, zoom: runtime.view?.webContents.getZoomFactor() }
            : null
        }),
      )
      .toMatchObject({
        bounds: expectedBounds,
        zoom: expect.closeTo(finalZoom, 3),
      })
    await testInfo.attach('settled-zoom-windows', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
    await closeWebsiteTestServer(server)
  }
})
