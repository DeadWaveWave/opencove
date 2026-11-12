import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { installPixelDrawProbe, readPixelDrawProbe } from './workspace-canvas.pixel-draw-probe'

test('both LOD transitions shed sparks from visible windows while the background is off', async ({
  browserName,
}, testInfo) => {
  void browserName
  const { electronApp, window } = await launchApp({ windowMode: 'inactive', deviceScaleFactor: 2 })
  try {
    await window.emulateMedia({ reducedMotion: 'no-preference' })
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: 'spark-note-1',
          kind: 'note',
          title: 'LOD sparks',
          position: { x: 100, y: 80 },
          width: 300,
          height: 240,
          task: { text: 'First note' },
        },
        {
          id: 'spark-note-2',
          kind: 'note',
          title: 'Second window',
          position: { x: 450, y: 80 },
          width: 300,
          height: 240,
          task: { text: 'Second note' },
        },
      ],
      {
        settings: {
          canvasBackgroundStyle: 'off',
          nodeCreationPixelEffectEnabled: false,
          nodeClosePixelEffectEnabled: false,
          agentWorkingPixelEffectEnabled: true,
        },
      },
    )
    const layer = window.getByTestId('workspace-pixel-layer')
    await expect(layer).toBeHidden()
    const transition = async (zoom: number) => {
      await installPixelDrawProbe(window)
      expect(
        await window.evaluate(z => window.__opencoveWorkspaceCanvasTestApi!.setZoom(z), zoom),
      ).toBe(true)
      // Retain actual draws: an inactive CI window paints decorative effects at only 10fps.
      await expect
        .poll(async () =>
          (await readPixelDrawProbe(window)).some(frame => frame.pixels.length === 20),
        )
        .toBe(true)
      await testInfo.attach(`lod-${zoom}-draws`, {
        body: JSON.stringify(await readPixelDrawProbe(window)),
        contentType: 'application/json',
      })
      await expect(layer).toBeHidden()
    }
    await transition(0.2)
    await transition(1)
  } finally {
    await testInfo.attach('lod-pixel-draws', {
      body: JSON.stringify(await readPixelDrawProbe(window).catch(() => [])),
      contentType: 'application/json',
    })
    await electronApp.close()
  }
})
