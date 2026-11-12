import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readWorkspaceViewState,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { seedWorkspaceViewport } from './workspace-canvas.viewState'

test('restores a seeded zoom despite an outgoing renderer persistence write', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 1.25 })
  const reload = window.reload.bind(window)

  try {
    await window.clock.install()
    await clearAndSeedWorkspace(window, [
      {
        id: 'node-viewport-seed',
        title: 'viewport-seed',
        position: { x: 80, y: 70 },
        width: 915,
        height: 654,
      },
    ])
    await window.clock.pauseAt(await window.evaluate(() => Date.now() + 1000))
    await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBe(1)

    // Queue a real persistence write from the live renderer, which still owns zoom 1.
    await window.locator('[data-testid="workspace-minimap-toggle"]').dispatchEvent('click')
    await expect(window.locator('.workspace-canvas__minimap')).toHaveCount(0)

    window.reload = async options => {
      // Widen the gap between seeding and navigation without inventing a storage write.
      // The app's debounced persistence callback must run before the old document exits.
      await window.clock.runFor(1000)
      const outgoing = await readWorkspaceViewState(window, seededWorkspaceId)
      await testInfo.attach('outgoing-view-state', {
        body: JSON.stringify(outgoing),
        contentType: 'application/json',
      })
      expect(outgoing).toMatchObject({ viewport: { zoom: 1 }, isMinimapVisible: false })
      await window.clock.resume()
      return await reload(options)
    }

    await seedWorkspaceViewport(window, seededWorkspaceId, { x: 0, y: 0, zoom: 1.06 })
    window.reload = reload
    await expect(window.locator('.workspace-canvas .react-flow__pane')).toBeVisible()
    try {
      await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeCloseTo(1.06, 2)
    } finally {
      await testInfo.attach('restored-view-state', {
        body: JSON.stringify({
          canvas: await readCanvasViewport(window),
          persisted: await readWorkspaceViewState(window, seededWorkspaceId),
        }),
        contentType: 'application/json',
      })
    }
    await expect
      .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.viewport.zoom)
      .toBe(1.06)

    // Seeding is one-shot: a later user viewport must survive an ordinary reload.
    await window.locator('.react-flow__controls-zoomin').click()
    await expect
      .poll(async () => (await readWorkspaceViewState(window, seededWorkspaceId))?.viewport.zoom)
      .toBeGreaterThan(1.06)
    const changedViewport = (await readWorkspaceViewState(window, seededWorkspaceId))!.viewport
    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect
      .poll(async () => (await readCanvasViewport(window)).zoom)
      .toBeCloseTo(changedViewport.zoom, 2)
  } finally {
    window.reload = reload
    await electronApp.close()
  }
})
