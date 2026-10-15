import { expect, test, type Page } from '@playwright/test'
import {
  dragLocatorTo,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  seedWorkspaceState,
  viewStateStorageKey,
} from './workspace-canvas.helpers'
import {
  createFilesystemNodeFixture,
  directoryEntry,
  FILESYSTEM_SPACE,
} from './workspace-canvas.filesystem-nodes.helpers'

const PROJECT = 'filesystem-drop-project'
const PEER = 'large-collapsed-note'
const PEER_FRAME = { x: 90, y: 120, width: 900, height: 650 }

type DropProbeWindow = Window & {
  __filesystemDropPoint?: { x: number; y: number }
}

async function seedDropWorkspace(page: Page, root: string, zoom: number) {
  await page.setViewportSize({ width: 1800, height: 1200 })
  await seedWorkspaceState(page, {
    activeWorkspaceId: PROJECT,
    settings: {
      uiTheme: 'pixel',
      language: 'en',
      canvasInputMode: 'mouse',
      focusNodeOnClick: false,
      standardWindowSizeBucket: 'regular',
      nodeCreationPixelEffectEnabled: false,
      nodeClosePixelEffectEnabled: false,
    },
    workspaces: [
      {
        id: PROJECT,
        name: 'Folder drop position',
        path: root,
        nodes: [
          {
            id: PEER,
            kind: 'note',
            title: 'Large note',
            position: { x: PEER_FRAME.x, y: PEER_FRAME.y },
            width: PEER_FRAME.width,
            height: PEER_FRAME.height,
            task: { text: 'The hidden expanded frame must not repel a folder icon.' },
          },
        ],
        spaces: [
          {
            id: FILESYSTEM_SPACE,
            name: 'Files',
            directoryPath: root,
            nodeIds: [PEER],
            rect: { x: 40, y: 50, width: 1100, height: 850 },
          },
        ],
      },
    ],
  })
  const viewport = { x: 50, y: 20, zoom }
  await page.evaluate(
    ({ key, id, value }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          activeWorkspaceId: id,
          workspaces: { [id]: { viewport: value, isMinimapVisible: false, activeSpaceId: null } },
        }),
      )
    },
    { key: viewStateStorageKey, id: PROJECT, value: viewport },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(() => readCanvasViewport(page)).toEqual(viewport)
  const peer = page.locator(`.react-flow__node[data-id="${PEER}"]`)
  const expanded = await readLocatorClientRect(peer.locator('.cove-node-presentation'))
  expect(expanded.width / zoom).toBeCloseTo(PEER_FRAME.width, 0)
  expect(expanded.height / zoom).toBeCloseTo(PEER_FRAME.height, 0)
  await peer.getByTestId('node-collapse').click()
  await expect(peer.locator('.cove-node-presentation')).toHaveAttribute(
    'data-cove-collapsed',
    'true',
  )
  await expect(peer.locator('[data-cove-collapse-motion]')).toHaveCount(0)
  await page.getByTestId(`workspace-space-files-${FILESYSTEM_SPACE}`).click()
  const explorer = page.getByTestId('workspace-space-explorer')
  await expect(explorer).toBeVisible()
  await explorer.getByRole('radio', { name: 'List', exact: true }).click()
  await expect(explorer.getByRole('tree')).toBeVisible()
}

async function blankPointInsideHiddenPeerFrame(page: Page) {
  return page.locator('.workspace-canvas .react-flow').evaluate((flow, frame) => {
    const bounds = flow.getBoundingClientRect()
    const viewport = flow.querySelector('.react-flow__viewport')!
    const transform = new DOMMatrixReadOnly(getComputedStyle(viewport).transform)
    // Every candidate is inside the old large note rectangle, but has room for
    // a 112 x 96 icon and is well clear of its actual collapsed corner.
    const offsets = [
      [450, 350],
      [650, 350],
      [450, 520],
      [650, 520],
      [250, 350],
      [650, 200],
      [450, 200],
    ]
    const blocked = '.react-flow__node, .workspace-space-explorer, .react-flow__panel'
    for (const [dx, dy] of offsets) {
      const x = bounds.x + transform.e + (frame.x + dx) * transform.a
      const y = bounds.y + transform.f + (frame.y + dy) * transform.d
      const samples = [
        [x, y],
        [x - 64 * transform.a, y - 56 * transform.d],
        [x + 64 * transform.a, y + 56 * transform.d],
      ]
      if (
        samples.every(([sx, sy]) => {
          const hit = document.elementFromPoint(sx, sy)
          return hit?.closest('.workspace-canvas') && !hit.closest(blocked)
        })
      ) {
        return { x, y }
      }
    }
    throw new Error('No visible free drop area remains inside the collapsed note expanded frame')
  }, PEER_FRAME)
}

async function readFolderPlacement(page: Page) {
  return page.evaluate(async projectId => {
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
        }>
        spaces: Array<{ id: string; nodeIds: string[] }>
      }>
    }
    const workspace = state.workspaces?.find(candidate => candidate.id === projectId)
    const node = workspace?.nodes.find(candidate => candidate.kind === 'folder')
    return node
      ? { ...node, spaceId: workspace?.spaces.find(space => space.nodeIds.includes(node.id))?.id }
      : null
  }, PROJECT)
}

for (const zoom of [0.65, 1.2]) {
  test(`drops a folder at the mouse position beside collapsed windows at zoom ${zoom}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const fixture = await createFilesystemNodeFixture()
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.root },
    })
    try {
      await seedDropWorkspace(window, fixture.root, zoom)
      const target = await blankPointInsideHiddenPeerFrame(window)
      const pane = window.locator('.workspace-canvas .react-flow__pane').first()
      const paneBox = await readLocatorClientRect(pane)
      const viewportBefore = await readCanvasViewport(window)
      await window.evaluate(() => {
        document.addEventListener(
          'drop',
          event => {
            ;(window as DropProbeWindow).__filesystemDropPoint = {
              x: event.clientX,
              y: event.clientY,
            }
          },
          { capture: true, once: true },
        )
      })
      await dragLocatorTo(window, directoryEntry(window, FILESYSTEM_SPACE, fixture.docs), pane, {
        targetPosition: { x: target.x - paneBox.x, y: target.y - paneBox.y },
      })
      const compact = window
        .locator('.react-flow__node')
        .filter({ has: window.locator('.folder-node') })
        .locator('.cove-collapsed-window')
      await expect(compact).toBeVisible()
      await expect(compact).toHaveText('docs')
      const released = await window.evaluate(
        () => (window as DropProbeWindow).__filesystemDropPoint,
      )
      expect(released).toBeDefined()
      await expect
        .poll(async () => {
          const box = await readLocatorClientRect(compact)
          return Math.hypot(
            box.x + box.width / 2 - released!.x,
            box.y + box.height / 2 - released!.y,
          )
        })
        .toBeLessThan(3)
      expect(await readCanvasViewport(window)).toEqual(viewportBefore)
      const compactBox = await readLocatorClientRect(compact)
      expect(compactBox.width / zoom).toBeCloseTo(112, 0)
      expect(compactBox.height / zoom).toBeCloseTo(96, 0)
      await expect
        .poll(() => readFolderPlacement(window))
        .toMatchObject({
          width: 516,
          height: 448,
          spaceId: FILESYSTEM_SPACE,
        })
      const folder = (await readFolderPlacement(window))!
      // The compact icon is intentionally inside the other node's durable
      // expanded frame: only visible geometry may participate in placement.
      expect(folder.position.x).toBeGreaterThan(PEER_FRAME.x + 112)
      expect(folder.position.x + 112).toBeLessThan(PEER_FRAME.x + PEER_FRAME.width)
      expect(folder.position.y).toBeGreaterThan(PEER_FRAME.y + 96)
      expect(folder.position.y + 96).toBeLessThan(PEER_FRAME.y + PEER_FRAME.height)
      await testInfo.attach(`folder-drop-at-mouse-${zoom}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })
}
