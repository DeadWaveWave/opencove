/* eslint-disable no-await-in-loop -- Real drag moves advance with renderer frames. */
import { expect, test, type Page } from '@playwright/test'
import {
  buildAppState,
  createWorkspaceDir,
  openAuthedCanvas,
  readSharedState,
  writeAppState,
} from './helpers'

const NODE_ID = 'compact-drag-note'

async function readFrame(page: Page) {
  return page.locator(`.react-flow__node[data-id="${NODE_ID}"]`).evaluate(element => {
    const node = element as HTMLElement
    const transform = new DOMMatrixReadOnly(node.style.transform)
    return { x: transform.e, y: transform.f, width: node.offsetWidth, height: node.offsetHeight }
  })
}

async function dragCompactIcon(page: Page, delta: { x: number; y: number }) {
  const node = page.locator(`.react-flow__node[data-id="${NODE_ID}"]`)
  await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
    'data-cove-collapse-motion',
  )
  const icon = page.getByTestId(`collapsed-node-${NODE_ID}`).locator('.cove-collapsed-window__icon')
  const { start, zoom } = await icon.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = document.querySelector('.react-flow__viewport')!
    return {
      start: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      zoom: new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a,
    }
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    // A burst of synthetic moves can finish within one WebKit frame. Give the
    // controlled selection/drag projection each position before releasing it.
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(
        start.x + (delta.x * zoom * step) / 12,
        start.y + (delta.y * zoom * step) / 12,
      )
      await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())),
      )
    }
  } finally {
    await page.mouse.up()
  }
  await expect(node).not.toHaveClass(/\bdragging\b/)
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

for (const nested of [false, true]) {
  test(`drags an unselected compact icon repeatedly ${nested ? 'inside a child Space' : 'inside a Space'} and across its boundary`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.stack || error.message))
    page.on('console', message => {
      if (
        message.type() === 'error' &&
        !message
          .text()
          .includes("The Content Security Policy directive 'frame-ancestors' is ignored")
      ) {
        errors.push(message.text())
      }
    })
    // WebKit reports deferred ResizeObserver delivery while the shell animates.
    // Keep it in diagnostics, but assert against renderer failures separately.
    const renderErrors = () => errors.filter(error => !error.startsWith('ResizeObserver loop'))
    const workspacePath = await createWorkspaceDir('collapsed-drag')
    const sourceId = nested ? 'child-space' : 'source-space'
    const spaces = [
      {
        id: 'source-space',
        name: 'Source',
        directoryPath: workspacePath,
        nodeIds: nested ? [] : [NODE_ID, 'peer-note'],
        rect: { x: 0, y: 0, width: 1060, height: 760 },
      },
      ...(nested
        ? [
            {
              id: sourceId,
              name: 'Child',
              directoryPath: workspacePath,
              parentSpaceId: 'source-space',
              nodeIds: [NODE_ID, 'peer-note'],
              rect: { x: 40, y: 60, width: 980, height: 620 },
            },
          ]
        : []),
      {
        id: 'target-space',
        name: 'Target',
        directoryPath: workspacePath,
        nodeIds: [],
        rect: { x: 1120, y: 0, width: 540, height: 760 },
      },
    ]
    await writeAppState(
      page.request,
      buildAppState({
        workspacePath,
        spaces,
        nodes: [
          {
            id: NODE_ID,
            title: 'Drag this compact window',
            kind: 'note',
            position: { x: 100, y: 130 },
            width: 460,
            height: 320,
            text: 'This content must remain intact after repeated compact drags.',
          },
          {
            id: 'peer-note',
            title: 'Keep this peer',
            kind: 'note',
            position: { x: 630, y: 350 },
            width: 280,
            height: 220,
            text: 'Stationary peer',
          },
        ],
        settings: {
          language: 'en',
          uiTheme: 'pixel',
          canvasInputMode: 'mouse',
          focusNodeOnClick: false,
          standbyBannerEnabled: false,
        },
      }),
    )
    try {
      await openAuthedCanvas(page)
      const node = page.locator(`.react-flow__node[data-id="${NODE_ID}"]`)
      await node.getByTestId('node-collapse').click()
      const compact = page.getByTestId(`collapsed-node-${NODE_ID}`)
      await expect(compact).toBeVisible()
      await expect.poll(() => readFrame(page)).toMatchObject({ width: 128, height: 112 })
      if (nested) {
        // Replacing an existing sibling selection exposed React's update-depth loop.
        const peer = page.locator('.react-flow__node[data-id="peer-note"]')
        await peer.getByTestId('node-collapse').click()
        await page
          .getByTestId('collapsed-node-peer-note')
          .getByTestId('node-expand')
          .click({ modifiers: ['Shift'] })
        await expect(peer).toHaveClass(/selected/)
      }
      await page.locator('.react-flow__controls-fitview').click()
      if (nested) {
        await page.locator('.react-flow__controls-zoomout').click({ clickCount: 3 })
      }
      await expect(node).not.toHaveClass(/selected/)
      await testInfo.attach('initial-renderer-errors', {
        body: JSON.stringify(errors, null, 2),
        contentType: 'application/json',
      })
      errors.length = 0

      const before = await readFrame(page)
      await dragCompactIcon(page, { x: 120, y: 70 })
      expect(renderErrors()).toEqual([])
      await expect(compact).toBeVisible()
      await expect.poll(() => readFrame(page)).toMatchObject({ width: 128, height: 112 })
      const first = await readFrame(page)
      expect(Math.hypot(first.x - before.x, first.y - before.y)).toBeGreaterThan(40)
      await expect(node).toHaveClass(/selected/)
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(1)

      await dragCompactIcon(page, { x: -70, y: 45 })
      expect(renderErrors()).toEqual([])
      const second = await readFrame(page)
      expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(30)
      await expect(compact).toBeVisible()

      await dragCompactIcon(page, { x: 1240 - second.x, y: 200 - second.y })
      expect(renderErrors()).toEqual([])
      await expect(compact).toBeVisible()
      await expect
        .poll(async () => {
          const state = await readSharedState(page.request)
          return state.state?.workspaces[0]?.spaces.find(space => space.id === 'target-space')
            ?.nodeIds
        })
        .toContain(NODE_ID)
      await page.locator('.react-flow__controls-fitview').click()
      await compact.getByTestId('node-expand').click()
      await expect(node.getByTestId('note-node-textarea')).toHaveValue(
        'This content must remain intact after repeated compact drags.',
      )
      expect(renderErrors()).toEqual([])
      await testInfo.attach('compact-node-after-cross-space-drag', {
        body: await page.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await testInfo.attach('renderer-errors', {
        body: JSON.stringify(errors, null, 2),
        contentType: 'application/json',
      })
    }
  })
}
