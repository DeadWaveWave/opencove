import { expect, test, type Page } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  seededWorkspaceId,
  testWorkspacePath,
  viewStateStorageKey,
} from './workspace-canvas.helpers'

async function readCreatedNode(window: Page) {
  return window.evaluate(async workspaceId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      workspaces?: Array<{
        id: string
        nodes: Array<{
          id: string
          kind: string
          position: { x: number; y: number }
          width: number
          height: number
          expectedDirectory?: string
        }>
        spaces: Array<{ id: string; nodeIds: string[] }>
      }>
    }
    const workspace = state.workspaces?.find(candidate => candidate.id === workspaceId)
    const node = workspace?.nodes[0]
    return node
      ? { ...node, spaceId: workspace?.spaces.find(space => space.nodeIds.includes(node.id))?.id }
      : null
  }, seededWorkspaceId)
}

async function restoreViewport(window: Page, zoom: number) {
  const initialViewport = { x: 130, y: -70, zoom }
  await window.evaluate(
    ({ key, workspaceId, viewport }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          activeWorkspaceId: workspaceId,
          workspaces: {
            [workspaceId]: { viewport, isMinimapVisible: false, activeSpaceId: null },
          },
        }),
      )
    },
    { key: viewStateStorageKey, workspaceId: seededWorkspaceId, viewport: initialViewport },
  )
  await window.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => readCanvasViewport(window)).toEqual(initialViewport)
}

for (const { entry, offset, zoom } of [
  { entry: 'double-click', offset: 60, zoom: 1 },
  { entry: 'note', offset: 60, zoom: 1 },
  { entry: 'terminal', offset: 60, zoom: 1 },
  { entry: 'double-click', offset: 60, zoom: 0.65 },
  { entry: 'double-click', offset: 180, zoom: 1 },
  { entry: 'note', offset: 180, zoom: 0.65 },
]) {
  test(`${entry} creation at ${offset}px from center with zoom ${zoom}`, async () => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [])
      await restoreViewport(window, zoom)
      const canvas = await readLocatorClientRect(window.locator('.workspace-canvas'))
      const flow = await readLocatorClientRect(window.locator('.workspace-canvas .react-flow'))
      const before = await readCanvasViewport(window)
      const center = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }
      const pointer = { x: center.x + offset, y: center.y + 20 }
      const expectedClient = offset < 120 ? center : pointer
      const expectedFlow = {
        x: (expectedClient.x - flow.x - before.x) / before.zoom,
        y: (expectedClient.y - flow.y - before.y) / before.zoom,
      }
      if (entry === 'double-click') {
        await window.mouse.dblclick(pointer.x, pointer.y)
      } else {
        await window.mouse.click(pointer.x, pointer.y, { button: 'right' })
        const menu = window.locator('.workspace-context-menu').first()
        await expect(menu).toBeVisible()
        const menuRect = await readLocatorClientRect(menu)
        expect(Math.abs(menuRect.x - pointer.x)).toBeLessThan(12)
        await window.getByTestId(`workspace-context-new-${entry}`).click()
      }
      await expect.poll(() => readCreatedNode(window)).not.toBeNull()
      const node = (await readCreatedNode(window))!
      expect(node.kind).toBe(entry === 'terminal' ? 'terminal' : 'note')
      expect(node.position.x + node.width / 2).toBeCloseTo(expectedFlow.x, 0)
      expect(node.position.y + node.height / 2).toBeCloseTo(expectedFlow.y, 0)
      if (entry === 'terminal') {
        expect(node.expectedDirectory).toBe(testWorkspacePath)
      }
      if (offset < 120) {
        const after = await readCanvasViewport(window)
        expect(after.x).toBeCloseTo(before.x, 0)
        expect(after.y).toBeCloseTo(before.y, 0)
        expect(after.zoom).toBeCloseTo(before.zoom, 4)
      }
      const screenshotPath = test.info().outputPath('created-window.png')
      await window.screenshot({ path: screenshotPath })
      await test.info().attach('created-window', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
}

test('near-center creation keeps the pointer space across a space boundary', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(window, [])
    const canvas = await readLocatorClientRect(window.locator('.workspace-canvas'))
    const center = { x: canvas.width / 2, y: canvas.height / 2 }
    await clearAndSeedWorkspace(window, [], {
      spaces: [
        {
          id: 'pointer-space',
          name: 'Pointer Space',
          directoryPath: testWorkspacePath,
          nodeIds: [],
          rect: { x: center.x + 20, y: 0, width: 1400, height: 1400 },
        },
      ],
    })
    const pane = window.locator('.workspace-canvas .react-flow__pane')
    const rect = await readLocatorClientRect(pane)
    await window.mouse.dblclick(rect.x + center.x + 80, rect.y + center.y)
    await expect.poll(async () => (await readCreatedNode(window))?.spaceId).toBe('pointer-space')
  } finally {
    await electronApp.close()
  }
})
