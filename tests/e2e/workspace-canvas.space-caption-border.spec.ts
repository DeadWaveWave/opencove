import { attachFailureFrame } from './diagnostics'
import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import {
  attachIdentityFrame,
  centerIdentityCanvas,
  createIdentityFixture,
  readSpaceIdentity,
  seedIdentityFixture,
} from './workspace-canvas.color-identity.helpers'
import { expectSpaceFrameHeader } from './workspace-canvas.space-caption-border.helpers'
import { wheelToZoom } from './workspace-canvas.zoom.helpers'

test('Space caption cutouts follow visible crossings through far-view hysteresis', async ({
  browserName,
}, testInfo) => {
  void browserName
  const fixture = await createIdentityFixture()
  const { electronApp, window: page } = await launchApp({
    env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
  })
  const transitions = []
  try {
    await (
      await electronApp.browserWindow(page)
    ).evaluate(window => window.setContentSize(1800, 1200))
    await seedIdentityFixture(page, fixture)
    // The same zoom has different caption geometry depending on which side we entered from.
    for (const [zoom, lod] of [
      [0.27, 'near'],
      [0.2, 'far'],
      [0.27, 'far'],
      [0.3, 'near'],
      [0.2, 'far'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- each transition must settle before the next.
      await wheelToZoom(page, zoom)
      // eslint-disable-next-line no-await-in-loop
      await expectSpaceFrameHeader(page, lod)
      // eslint-disable-next-line no-await-in-loop
      const spaces = await readSpaceIdentity(page)
      transitions.push({ zoom, lod, spaces })
      if (lod === 'far') {
        expect(spaces.every(space => space.edge.captions.length === 0)).toBe(true)
      }
    }
    const restore = await centerIdentityCanvas(page)
    await attachIdentityFrame(page, testInfo, 'far-space-caption-above-frame')
    const label = page.getByTestId('workspace-space-label-pixel-build-space')
    await label.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('workspace-space-files-pixel-build-space')).toBeFocused()
    // Revealing actions moves the title back across the border, even though LOD stays far.
    await expectSpaceFrameHeader(page, 'far')
    const focused = (await readSpaceIdentity(page)).find(space => space.id === 'pixel-build-space')!
    expect(focused.edge.captions.map(caption => caption.kind)).toContain('title')
    await attachIdentityFrame(page, testInfo, 'far-space-focused-caption-cutout')
    await page.keyboard.press('Tab')
    await page
      .getByTestId('workspace-space-menu-pixel-build-space')
      .evaluate(element => (element as HTMLElement).blur())
    await page.mouse.move(320, 44)
    await expectSpaceFrameHeader(page, 'far')
    expect((await readSpaceIdentity(page)).every(space => space.edge.clip === 'none')).toBe(true)
    await restore()
    await testInfo.attach('far-space-caption-metrics', {
      body: JSON.stringify({ transitions, focused }, null, 2),
      contentType: 'application/json',
    })
  } catch (error) {
    await attachFailureFrame(page, test.info())
    throw error
  } finally {
    await electronApp.close()
    await fixture.cleanup()
  }
})
