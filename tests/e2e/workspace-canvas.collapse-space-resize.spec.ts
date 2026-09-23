/* eslint-disable no-await-in-loop -- Zoom steps wait for their rendered viewport before the next click. */
import { expect, test, type Page } from '@playwright/test'
import { dragMouse, launchApp, readLocatorClientRect } from './workspace-canvas.helpers'
import { readChildSpaceSnapshot } from './workspace-canvas.child-space.helpers'
import {
  EXPANSION_PEER,
  EXPANSION_TERMINAL,
  readPersistedFrame,
  readTerminalIdentity,
  writeCollapsedTerminalMarker,
} from './workspace-canvas.collapse-expansion.helpers'
import {
  MOTION_SPACE,
  readPresentationFrame,
  seedCollapseMotionFixture,
  spaceSelector,
  terminalSelector,
} from './workspace-canvas.collapse-motion.helpers'

async function shrinkSpace(page: Page, edge: 'right' | 'bottom', distance: number) {
  const handle = await readLocatorClientRect(
    page.getByTestId(`workspace-space-drag-${MOTION_SPACE}-${edge}`),
  )
  const zoom = await page.locator('.react-flow__viewport').evaluate(element => {
    return new DOMMatrixReadOnly(getComputedStyle(element).transform).a
  })
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await dragMouse(page, {
    start,
    end: {
      x: start.x - (edge === 'right' ? distance * zoom : 0),
      y: start.y - (edge === 'bottom' ? distance * zoom : 0),
    },
    steps: 18,
  })
}

async function enterOverview(page: Page) {
  const canvas = page.locator('.workspace-canvas')
  const readZoom = () =>
    page
      .locator('.react-flow__viewport')
      .evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
  for (let step = 0; step < 10; step += 1) {
    if ((await canvas.getAttribute('data-cove-space-overview')) === 'true') {
      return
    }
    const before = await readZoom()
    await page.locator('.react-flow__controls-zoomout').click()
    await expect.poll(readZoom).toBeLessThan(before - 0.01)
  }
  await expect(canvas).toHaveAttribute('data-cove-space-overview', 'true')
}

for (const nesting of ['root', 'nested'] as const) {
  test(`manually resizes ${nesting} Space around visible compact windows without using their expanded bounds`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await seedCollapseMotionFixture(window, nesting === 'nested' ? 'nested' : true)
      const identity = await readTerminalIdentity(window)
      const original = await readPresentationFrame(window, spaceSelector)
      await window.locator(terminalSelector).getByTestId('node-collapse').click()
      await window
        .locator(`.react-flow__node[data-id="${EXPANSION_PEER}"]`)
        .getByTestId('node-collapse')
        .click()
      await expect
        .poll(() => readPresentationFrame(window))
        .toMatchObject({ width: expect.closeTo(112, 0), height: expect.closeTo(96, 0) })

      // No arrange action: each window retains its original position. The right
      // edge must stop at the note's compact extent, not its original width.
      await shrinkSpace(window, 'right', 750)
      await expect
        .poll(async () => (await readPresentationFrame(window, spaceSelector)).width)
        .toBeLessThan(original.width - 100)
      await shrinkSpace(window, 'bottom', 350)
      await expect
        .poll(async () => (await readPresentationFrame(window, spaceSelector)).height)
        .toBeLessThan(240)
      const space = await readPresentationFrame(window, spaceSelector)
      const [terminal, note] = await Promise.all([
        readPresentationFrame(window),
        readPresentationFrame(
          window,
          `.react-flow__node[data-id="${EXPANSION_PEER}"] .cove-node-presentation`,
        ),
      ])
      for (const frame of [terminal, note]) {
        // Dividing DOM rectangles by zoom can differ by floating-point roundoff.
        const epsilon = 1e-6
        expect(frame.x).toBeGreaterThanOrEqual(space.x - epsilon)
        expect(frame.y).toBeGreaterThanOrEqual(space.y - epsilon)
        expect(frame.x + frame.width).toBeLessThanOrEqual(space.x + space.width + epsilon)
        expect(frame.y + frame.height).toBeLessThanOrEqual(space.y + space.height + epsilon)
      }
      await expect
        .poll(() => readPersistedFrame(window, EXPANSION_TERMINAL))
        .toMatchObject({ x: 72, y: 100, width: 560, height: 320 })
      await expect
        .poll(() => readPersistedFrame(window, EXPANSION_PEER))
        .toMatchObject({ x: 760, y: 100, width: 340, height: 260 })

      // With one compact window left, the frame should reach its title/control
      // minimum, rather than reserving the default expanded terminal's size.
      const compactNote = window.getByTestId(`collapsed-node-${EXPANSION_PEER}`)
      await compactNote.getByTestId('node-expand').click({ button: 'right' })
      await window.getByTestId('workspace-node-close').click()
      await expect(window.locator(`.react-flow__node[data-id="${EXPANSION_PEER}"]`)).toHaveCount(0)
      await shrinkSpace(window, 'right', 750)
      await expect
        .poll(async () => (await readPresentationFrame(window, spaceSelector)).width)
        .toBeCloseTo(224, 0)
      await expect
        .poll(async () => (await readChildSpaceSnapshot(window)).spaces[MOTION_SPACE])
        .toMatchObject({ x: 40, y: 50, width: 224, height: expect.any(Number) })
      expect((await readChildSpaceSnapshot(window)).spaces[MOTION_SPACE].height).toBeLessThan(240)
      await expect(window.getByTestId(`workspace-space-label-${MOTION_SPACE}`)).toBeVisible()
      await expect(window.getByTestId(`workspace-space-menu-${MOTION_SPACE}`)).toBeVisible()
      const controls = await window.locator(spaceSelector).evaluate(element => {
        return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).map(button => {
          const rect = button.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return {
            id: button.dataset.testid,
            width: rect.width,
            hit: hit === button || (hit !== null && button.contains(hit)),
          }
        })
      })
      expect(controls.length).toBeGreaterThanOrEqual(4)
      expect(controls.every(control => control.width > 8 && control.hit)).toBe(true)
      expect(await readTerminalIdentity(window)).toEqual(identity)
      await writeCollapsedTerminalMarker(window, identity.sessionId!)
      await testInfo.attach('manually-shrunk-space-around-compact-terminal', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      if (nesting === 'nested') {
        await enterOverview(window)
        await window
          .locator(spaceSelector)
          .locator('.workspace-space-region__label-group--left')
          .hover()
        await testInfo.attach('compact-child-space-overview-controls', {
          body: await window.screenshot(),
          contentType: 'image/png',
        })
        await window.getByTestId(`workspace-space-files-${MOTION_SPACE}`).click()
        await expect(window.getByTestId('workspace-space-explorer')).toBeVisible()
      }
    } finally {
      await electronApp.close()
    }
  })
}
