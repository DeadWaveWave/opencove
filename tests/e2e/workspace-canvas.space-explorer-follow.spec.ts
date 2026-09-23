import { expect, test, type Page } from '@playwright/test'
import {
  beginDragMouse,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import {
  createFilesystemNodeFixture,
  FILESYSTEM_SPACE,
} from './workspace-canvas.filesystem-nodes.helpers'

function spaceRegion(page: Page, id: string) {
  return page.locator(`.workspace-space-region:has([data-testid="workspace-space-drag-${id}-top"])`)
}

async function readRelativeFrame(page: Page) {
  const [space, explorer] = await Promise.all([
    readLocatorClientRect(spaceRegion(page, FILESYSTEM_SPACE)),
    readLocatorClientRect(page.getByTestId('workspace-space-explorer')),
  ])
  return {
    x: explorer.x - space.x,
    y: explorer.y - space.y,
    width: explorer.width,
    height: explorer.height,
  }
}

for (const draggedId of [FILESYSTEM_SPACE, 'files-parent']) {
  test(`keeps the child Explorer attached during ${draggedId === FILESYSTEM_SPACE ? 'child' : 'parent'} Space drag and release`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const fixture = await createFilesystemNodeFixture()
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.root },
    })
    try {
      await window.setViewportSize({ width: 1520, height: 1040 })
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'files-project',
        settings: {
          uiTheme: 'pixel',
          language: 'en',
          canvasInputMode: 'mouse',
        },
        workspaces: [
          {
            id: 'files-project',
            name: 'Explorer follows Space',
            path: fixture.root,
            nodes: [],
            spaces: [
              {
                id: 'files-parent',
                name: 'Parent',
                directoryPath: fixture.root,
                nodeIds: [],
                rect: { x: 60, y: 70, width: 1000, height: 740 },
              },
              {
                id: FILESYSTEM_SPACE,
                name: 'Child files',
                directoryPath: fixture.root,
                parentSpaceId: 'files-parent',
                nodeIds: [],
                rect: { x: 150, y: 160, width: 640, height: 480 },
              },
            ],
          },
        ],
      })
      await window.locator('.react-flow__controls-fitview').click()
      await window.getByTestId(`workspace-space-files-${FILESYSTEM_SPACE}`).click()
      const explorer = window.getByTestId('workspace-space-explorer')
      await expect(explorer).toBeVisible()
      const identity = await explorer.elementHandle()
      const baseline = await readRelativeFrame(window)
      const initialSpace = await readLocatorClientRect(spaceRegion(window, FILESYSTEM_SPACE))
      const handle = await readLocatorClientRect(
        window.getByTestId(`workspace-space-drag-${draggedId}-top`),
      )
      const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height * 0.35 }
      const zoom = (await readCanvasViewport(window)).zoom
      const drag = await beginDragMouse(window, {
        start,
        initialTarget: { x: start.x + 90 * zoom, y: start.y + 60 * zoom },
      })
      const moveAndCheck = async (dx: number, dy: number) => {
        await drag.moveTo({ x: start.x + dx * zoom, y: start.y + dy * zoom })
        await expect
          .poll(async () => {
            const rect = await readLocatorClientRect(spaceRegion(window, FILESYSTEM_SPACE))
            return Math.hypot(
              rect.x - initialSpace.x - dx * zoom,
              rect.y - initialSpace.y - dy * zoom,
            )
          })
          .toBeLessThan(2)
        await expect
          .poll(() => readRelativeFrame(window))
          .toMatchObject({
            x: expect.closeTo(baseline.x, 0),
            y: expect.closeTo(baseline.y, 0),
            width: expect.closeTo(baseline.width, 0),
            height: expect.closeTo(baseline.height, 0),
          })
      }
      await moveAndCheck(30, 20)
      await moveAndCheck(60, 40)
      await moveAndCheck(90, 60)
      const beforeRelease = await readRelativeFrame(window)
      await drag.release()
      // Snap is a canvas-local control and applies on commit, so the Space can
      // legitimately move a few pixels on release. Its Explorer must follow
      // the same movement rather than keeping the last preview coordinates.
      await expect
        .poll(() => readRelativeFrame(window))
        .toMatchObject({
          x: expect.closeTo(beforeRelease.x, 0),
          y: expect.closeTo(beforeRelease.y, 0),
          width: expect.closeTo(beforeRelease.width, 0),
          height: expect.closeTo(beforeRelease.height, 0),
        })
      expect(await identity!.evaluate(element => element.isConnected)).toBe(true)
      await testInfo.attach(`explorer-follows-${draggedId}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })
}
