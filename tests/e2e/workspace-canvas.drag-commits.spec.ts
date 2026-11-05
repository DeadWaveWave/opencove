import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import {
  DRAG_NODE,
  prepareDragScene,
  sampleContinuousDrag,
} from './workspace-canvas.drag-performance.helpers'

test('dragging commits only the moving window and persists its final geometry on release', async () => {
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 2 })
  const readNode = () =>
    window.evaluate(async id => {
      const state = JSON.parse(
        (await window.opencoveApi.persistence.readWorkspaceStateRaw()) ?? '{}',
      )
      return state.workspaces?.[0]?.nodes?.find((node: { id: string }) => node.id === id)
    }, DRAG_NODE)
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900, false),
    )
    const session = await window.context().newCDPSession(window)
    await session.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'no-preference' },
        { name: 'prefers-reduced-transparency', value: 'no-preference' },
      ],
    })
    await prepareDragScene(window)
    const before = await readNode()
    const result = await sampleContinuousDrag(window, 120)
    // eslint-disable-next-line no-console -- retain per-window evidence if this invariant regresses.
    console.log('[drag commits]', JSON.stringify(result))
    await test.info().attach('drag-commits', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    expect(result.persistedPositionDuringDrag).toEqual(before.position)
    const { [DRAG_NODE]: moving = 0, ...otherHeaders } = result.windowCommitsByNode!
    expect(moving).toBeGreaterThan(0)
    expect(otherHeaders).toEqual({})
    const { [DRAG_NODE]: movingShell = 0 } = result.presentationCommits!
    expect(movingShell).toBeGreaterThan(0)
    expect(result.minimapMutations).toBe(0)
    const position = await window
      .locator(`.react-flow__node[data-id="${DRAG_NODE}"]`)
      .evaluate(element => {
        const matrix = new DOMMatrixReadOnly((element as HTMLElement).style.transform)
        return { x: matrix.m41, y: matrix.m42 }
      })
    // Inline transforms round coordinates; persistence retains the full precision.
    await expect
      .poll(async () => (await readNode()).position)
      .toEqual({
        x: expect.closeTo(position.x, 3),
        y: expect.closeTo(position.y, 3),
      })
    const after = await readNode()
    expect(after).toEqual({ ...before, position: after.position })
    await expect
      .poll(() =>
        window.evaluate(
          point =>
            window
              .__opencovePixelWallTestApi!.getLights()
              .some(
                light =>
                  Math.abs(light.x - point.x) < 0.1 &&
                  Math.abs(light.y - point.y) < 0.1 &&
                  light.width === 360 &&
                  light.height === 240,
              ),
          position,
        ),
      )
      .toBe(true)
    await test
      .info()
      .attach('settled-drag-windows', { body: await window.screenshot(), contentType: 'image/png' })
  } finally {
    await electronApp.close()
  }
})
