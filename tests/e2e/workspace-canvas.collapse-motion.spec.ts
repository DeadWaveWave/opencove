import { expect, test } from '@playwright/test'
import { dragMouse, launchApp, readLocatorClientRect } from './workspace-canvas.helpers'
import {
  EXPANSION_PEER,
  EXPANSION_TERMINAL,
  readNodeFrame,
  readTerminalIdentity,
  writeCollapsedTerminalMarker,
} from './workspace-canvas.collapse-expansion.helpers'
import {
  MOTION_SPACE,
  expectContinuousSizeChange,
  expectRuntimeUnchanged,
  presentationSelector,
  readPresentationFrame,
  sampleAnimatedPresentation,
  samplePresentation,
  seedCollapseMotionFixture,
  spaceSelector,
  terminalSelector,
} from './workspace-canvas.collapse-motion.helpers'

test('morphs a live terminal into its icon and back without remounting or resizing the PTY', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await seedCollapseMotionFixture(window)
    const node = window.locator(terminalSelector)
    const expanded = await readPresentationFrame(window)
    const identity = await readTerminalIdentity(window)
    const collapse = await sampleAnimatedPresentation(window, () =>
      node.getByTestId('node-collapse').click(),
    )
    expectContinuousSizeChange(collapse, expanded, { width: 112, height: 96 })
    expectRuntimeUnchanged(collapse, identity)
    const compact = window.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)
    await expect(compact.getByTestId('node-expand')).toBeVisible()
    expect(await readTerminalIdentity(window)).toEqual(identity)
    await writeCollapsedTerminalMarker(window, identity.sessionId!)

    const expansion = await sampleAnimatedPresentation(window, () =>
      compact.getByTestId('node-expand').click(),
    )
    expectContinuousSizeChange(expansion, { width: 112, height: 96 }, expanded)
    expectRuntimeUnchanged(expansion, identity)
    await expect(compact).toBeHidden()
    await expect(node.locator('.terminal-node__terminal')).toBeVisible()
    expect(await readTerminalIdentity(window)).toEqual(identity)
    expect(
      await window.evaluate(async sessionId => {
        const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId })
        return { cols: snapshot.cols, rows: snapshot.rows }
      }, identity.sessionId!),
    ).toEqual(identity.size)
    await writeCollapsedTerminalMarker(window, identity.sessionId!, 'expanded')
    await testInfo.attach('collapse-expand-visible-geometry', {
      body: JSON.stringify({ collapse, expansion }, null, 2),
      contentType: 'application/json',
    })
    await testInfo.attach('expanded-live-terminal', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
  }
})

test('Space fold arranges real compact windows and leaves an ordinary movable resizable Space', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await seedCollapseMotionFixture(window, true)
    const before = await readPresentationFrame(window, spaceSelector)
    const identity = await readTerminalIdentity(window)
    // Space movement starts after the windows fold. Sample its real active phase
    // separately from that delay, then resume the clock to exercise natural cleanup.
    const samples = await sampleAnimatedPresentation(
      window,
      () => window.getByTestId(`workspace-space-collapse-arrange-${MOTION_SPACE}`).click(),
      { selector: spaceSelector, phase: 'active' },
    )
    const after = await readPresentationFrame(window, spaceSelector)
    expect(after.width * after.height).toBeLessThan(before.width * before.height * 0.7)
    expectContinuousSizeChange(samples, before, after)
    expectRuntimeUnchanged(samples, identity)
    await expect(window.getByTestId(`workspace-space-summary-${MOTION_SPACE}`)).toHaveCount(0)
    await expect(window.getByTestId(`workspace-space-collapse-${MOTION_SPACE}`)).toHaveCount(0)
    await expect(window.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)).toBeVisible()
    await expect(window.getByTestId(`collapsed-node-${EXPANSION_PEER}`)).toBeVisible()
    await expect(window.locator(spaceSelector).locator('.lucide-fold-vertical')).toBeVisible()

    const compactBeforeDrag = await readNodeFrame(window, EXPANSION_TERMINAL)
    const handle = await readLocatorClientRect(
      window.getByTestId(`workspace-space-drag-${MOTION_SPACE}-top`),
    )
    const start = { x: handle.x + handle.width * 0.82, y: handle.y + handle.height / 2 }
    await dragMouse(window, {
      start,
      end: { x: start.x + 95, y: start.y + 70 },
      steps: 14,
    })
    await expect
      .poll(async () => {
        const moved = await readNodeFrame(window, EXPANSION_TERMINAL)
        return Math.hypot(moved.x - compactBeforeDrag.x, moved.y - compactBeforeDrag.y)
      })
      .toBeGreaterThan(30)
    const beforeResize = await readPresentationFrame(window, spaceSelector)
    const resize = await readLocatorClientRect(
      window.getByTestId(`workspace-space-drag-${MOTION_SPACE}-right`),
    )
    const resizeStart = { x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 }
    await dragMouse(window, {
      start: resizeStart,
      end: { x: resizeStart.x + 90, y: resizeStart.y },
      steps: 14,
    })
    await expect
      .poll(async () => (await readPresentationFrame(window, spaceSelector)).width)
      .toBeGreaterThan(beforeResize.width + 20)
    await expect(window.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)).toBeVisible()
    expect(await readTerminalIdentity(window)).toEqual(identity)
    await testInfo.attach('space-arrange-morph-geometry', {
      body: JSON.stringify(samples, null, 2),
      contentType: 'application/json',
    })
    await testInfo.attach('compact-windows-in-normal-space', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })

    // A one-window Space still needs room for its frame title and controls.
    const note = window.getByTestId(`collapsed-node-${EXPANSION_PEER}`)
    await note.getByTestId('node-expand').click({ button: 'right' })
    await window.getByTestId('workspace-node-close').click()
    await expect(window.locator(`.react-flow__node[data-id="${EXPANSION_PEER}"]`)).toHaveCount(0)
    await window.getByTestId(`workspace-space-collapse-arrange-${MOTION_SPACE}`).click()
    await expect
      .poll(async () => (await readPresentationFrame(window, spaceSelector)).width)
      .toBeCloseTo(224, 0)
    await expect
      .poll(
        async () =>
          (await readLocatorClientRect(window.getByTestId(`workspace-space-label-${MOTION_SPACE}`)))
            .width,
      )
      .toBeGreaterThan(35)
    await expect(window.getByTestId(`workspace-space-menu-${MOTION_SPACE}`)).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('a rapid reversal and reduced motion leave the final geometry and live runtime intact', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await seedCollapseMotionFixture(window)
    const node = window.locator(terminalSelector)
    const expanded = await readPresentationFrame(window)
    const identity = await readTerminalIdentity(window)
    const compact = window.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)
    const reversal = await samplePresentation(window, async () => {
      await node.getByTestId('node-collapse').click()
      await expect
        .poll(async () => (await readPresentationFrame(window)).width, { intervals: [16] })
        .toBeLessThan(expanded.width - 8)
      // The visible icon remains usable during motion; dispatch a real pointer
      // click without Playwright waiting for this moving hit target to settle.
      const target = await readLocatorClientRect(compact.getByTestId('node-expand'))
      await window.mouse.click(target.x + target.width / 2, target.y + target.height / 2)
    })
    expectRuntimeUnchanged(reversal, identity)
    expect(
      reversal.some(sample => sample.shell.width < expanded.width - 8 && sample.shell.width > 132),
    ).toBe(true)
    expect(reversal.at(-1)?.shell.width).toBeCloseTo(expanded.width, 0)
    await expect(compact).toBeHidden()
    expect(
      await window
        .locator(presentationSelector)
        .evaluate(element => element.getAnimations().length),
    ).toBe(0)

    await window.emulateMedia({ reducedMotion: 'reduce' })
    const reduced = await samplePresentation(window, () =>
      node.getByTestId('node-collapse').click(),
    )
    expectRuntimeUnchanged(reduced, identity)
    expect(
      reduced.filter(sample => sample.shell.width > 130 && sample.shell.width < expanded.width - 2),
      'Reduced motion commits the final presentation without traversing an animated size',
    ).toEqual([])
    expect(reduced.at(-1)?.shell.width).toBeCloseTo(112, 0)
    await compact.getByTestId('node-expand').click()
    await expect
      .poll(() => readPresentationFrame(window))
      .toMatchObject({
        width: expect.closeTo(expanded.width, 0),
        height: expect.closeTo(expanded.height, 0),
      })
    expect(await readTerminalIdentity(window)).toEqual(identity)
    await testInfo.attach('rapid-reversal-and-reduced-motion', {
      body: JSON.stringify({ reversal, reduced }, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await electronApp.close()
  }
})
