import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import {
  EXPANSION_PEER,
  EXPANSION_TERMINAL,
  framesOverlap,
  readNodeFrame,
  readPersistedFrame,
  readTerminalIdentity,
  sampleCollapsedDrag,
  seedExpansionFixture,
  writeCollapsedTerminalMarker,
} from './workspace-canvas.collapse-expansion.helpers'

for (const behavior of ['default', 'find-space'] as const) {
  test(`expanding a moved compact window ${behavior === 'default' ? 'pushes occupied peers away by default' : 'finds free space without moving peers'}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await seedExpansionFixture(window, behavior === 'find-space' ? behavior : undefined)
      const node = window.locator(`.react-flow__node[data-id="${EXPANSION_TERMINAL}"]`)
      const expanded = await readNodeFrame(window, EXPANSION_TERMINAL)
      const identity = await readTerminalIdentity(window)
      expect(identity.sessionId).toBeTruthy()
      expect(identity.instanceId).toBeTruthy()
      const peerBeforeDrag = await readNodeFrame(window, EXPANSION_PEER)
      await node.getByTestId('node-collapse').click()
      const compact = window.getByTestId(`collapsed-node-${EXPANSION_TERMINAL}`)
      await expect(compact).toBeVisible()
      await expect
        .poll(() => readNodeFrame(window, EXPANSION_TERMINAL))
        .toMatchObject({ width: 112, height: 96 })
      await writeCollapsedTerminalMarker(window, identity.sessionId!, 'collapsed')
      const samples = await sampleCollapsedDrag(window)
      await testInfo.attach('collapsed-drag-frame-geometry', {
        body: JSON.stringify(samples, null, 2),
        contentType: 'application/json',
      })
      expect(samples.length).toBeGreaterThanOrEqual(20)
      expect(samples.filter(sample => sample.selection).length).toBeGreaterThanOrEqual(20)
      const oversized = samples.filter(
        sample =>
          sample.node.width > 132 ||
          sample.node.height > 116 ||
          (sample.selection && (sample.selection.width > 132 || sample.selection.height > 116)),
      )
      expect(
        oversized,
        'Every rendered drag frame stays compact, including its selection outline',
      ).toEqual([])
      expect(
        samples.every(
          sample =>
            sample.runtime.width === identity.body?.width &&
            sample.runtime.height === identity.body?.height,
        ),
      ).toBe(true)
      expect(await readTerminalIdentity(window)).toEqual(identity)
      const beforeExpand = await readNodeFrame(window, EXPANSION_TERMINAL)
      const peerBeforeExpand = await readNodeFrame(window, EXPANSION_PEER)
      expect(beforeExpand.x).toBeGreaterThan(expanded.x + 200)
      expect(peerBeforeExpand).toEqual(peerBeforeDrag)
      expect(framesOverlap(beforeExpand, peerBeforeExpand)).toBe(false)
      expect(
        framesOverlap(
          { ...beforeExpand, width: expanded.width, height: expanded.height },
          peerBeforeExpand,
        ),
      ).toBe(true)
      await expect
        .poll(() => readPersistedFrame(window, EXPANSION_TERMINAL))
        .toEqual({
          // CSS matrices use lower precision than the persisted canvas coordinates.
          x: expect.closeTo(beforeExpand.x, 1),
          y: expect.closeTo(beforeExpand.y, 1),
          width: expanded.width,
          height: expanded.height,
        })
      await testInfo.attach('compact-window-beside-occupied-peer', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await compact.getByTestId('node-expand').click()
      await expect(compact).toBeHidden()
      await expect
        .poll(() => readNodeFrame(window, EXPANSION_TERMINAL))
        .toMatchObject({ width: expanded.width, height: expanded.height })
      await expect
        .poll(async () =>
          framesOverlap(
            await readNodeFrame(window, EXPANSION_TERMINAL),
            await readNodeFrame(window, EXPANSION_PEER),
          ),
        )
        .toBe(false)
      const afterExpand = await readNodeFrame(window, EXPANSION_TERMINAL)
      const peerAfterExpand = await readNodeFrame(window, EXPANSION_PEER)
      if (behavior === 'default') {
        expect({ x: afterExpand.x, y: afterExpand.y }).toEqual({
          x: expect.closeTo(beforeExpand.x, 1),
          y: expect.closeTo(beforeExpand.y, 1),
        })
        expect(
          Math.hypot(
            peerAfterExpand.x - peerBeforeExpand.x,
            peerAfterExpand.y - peerBeforeExpand.y,
          ),
        ).toBeGreaterThan(50)
      } else {
        expect(peerAfterExpand).toEqual(peerBeforeExpand)
        expect(
          Math.hypot(afterExpand.x - beforeExpand.x, afterExpand.y - beforeExpand.y),
        ).toBeGreaterThan(50)
      }
      expect({ width: peerAfterExpand.width, height: peerAfterExpand.height }).toEqual({
        width: peerBeforeExpand.width,
        height: peerBeforeExpand.height,
      })
      expect(await readTerminalIdentity(window)).toEqual(identity)
      await expect
        .poll(() => readPersistedFrame(window, EXPANSION_TERMINAL))
        .toEqual({
          x: expect.closeTo(afterExpand.x, 1),
          y: expect.closeTo(afterExpand.y, 1),
          width: afterExpand.width,
          height: afterExpand.height,
        })
      expect(
        await window.evaluate(async id => {
          const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId: id })
          return { cols: snapshot.cols, rows: snapshot.rows }
        }, identity.sessionId!),
      ).toEqual(identity.size)
      await writeCollapsedTerminalMarker(window, identity.sessionId!, 'expanded')
      await window.locator('.react-flow__controls-fitview').click()
      await testInfo.attach(`expanded-window-${behavior}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
}
