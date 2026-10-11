import { expect, test, type Page } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

async function haveIdenticalPixels(page: Page, before: Buffer, after: Buffer): Promise<boolean> {
  // Compare rendered pixels, not optional PNG metadata such as color profiles.
  return await page.evaluate(
    async images => {
      const decoded = await Promise.all(
        images.map(async base64 => {
          const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
            colorSpaceConversion: 'none',
          })
          try {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
            const context = canvas.getContext('2d')
            if (!context) {
              throw new Error('Unable to decode terminal screenshot')
            }
            context.drawImage(bitmap, 0, 0)
            return context.getImageData(0, 0, bitmap.width, bitmap.height)
          } finally {
            bitmap.close()
          }
        }),
      )
      const [left, right] = decoded
      return (
        left.width === right.width &&
        left.height === right.height &&
        left.data.every((value, index) => value === right.data[index])
      )
    },
    [before.toString('base64'), after.toString('base64')],
  )
}

test('preserves existing glyph pixels when another WebGL terminal is created and closed', async () => {
  test.skip(process.platform !== 'win32', 'Windows WebGL at 150% scale')
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 1.5 })
  try {
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: 'atlas-owner',
          title: 'atlas-owner',
          position: { x: 350, y: 80 },
          width: 520,
          height: 340,
        },
      ],
      // A sibling's opening/closing particles can cross the unchanged terminal's
      // screenshot. Separate effect suites cover them; this fixture compares its atlas.
      { settings: { nodeCreationPixelEffectEnabled: false, nodeClosePixelEffectEnabled: false } },
    )
    const terminal = window.locator('[data-id="atlas-owner"] .terminal-node')
    await expect
      .poll(() =>
        window.evaluate(() =>
          window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId('atlas-owner'),
        ),
      )
      .toBeTruthy()
    const text =
      '\x1b[2J\x1b[H\x1b[?25l' +
      '\x1b[38;2;10;180;200mATLAS_STATIC_0123456789\r\n' +
      '\x1b[38;2;220;130;40mABCDEFGHIJKLMNOPQRSTUVWXYZ\r\n' +
      '\x1b[0mabcdefghijklmnopqrstuvwxyz !@#$%^&*()\r\n'
    await terminal.locator('.xterm-helper-textarea').focus()
    await window.keyboard.type(
      buildNodeEvalCommand(
        `process.stdout.write(${JSON.stringify(text)});setInterval(()=>{},1000)`,
      ),
    )
    await window.keyboard.press('Enter')
    await expect
      .poll(() =>
        window.evaluate(
          () =>
            window.__opencoveTerminalSelectionTestApi?.getBufferText('atlas-owner', 'ATLAS_STATIC')
              ?.viewportLines[0],
        ),
      )
      .toBe('ATLAS_STATIC_0123456789')
    await expect
      .poll(() =>
        window.evaluate(
          () =>
            window.__opencoveTerminalSelectionTestApi?.getRenderMetrics('atlas-owner')
              ?.rendererStructuralKind,
        ),
      )
      .toBe('webgl')
    const screen = terminal.locator('.xterm-screen')
    const camera = await window
      .locator('.react-flow__viewport')
      .first()
      .evaluate(element => (element as HTMLElement).style.transform)
    // Compare the same physical pixel grid, including fractional camera translation.
    // Screenshot styles are temporary and do not alter xterm's renderer or glyph atlas.
    const captureStyle = `.react-flow__viewport { transform: ${camera} !important; }`
    const before = await screen.screenshot({ style: captureStyle })
    await test
      .info()
      .attach('glyphs-before-new-terminal', { body: before, contentType: 'image/png' })

    /* eslint-disable no-await-in-loop -- create, repaint, compare and close must settle in that order */
    for (let round = 0; round < 3; round += 1) {
      await window
        .locator('.react-flow__pane')
        .click({ button: 'right', position: { x: 950, y: 500 } })
      await window.getByTestId('workspace-context-new-terminal').click()
      const sibling = window.locator(
        '.react-flow__node:not([data-id="atlas-owner"]) .terminal-node',
      )
      await expect(window.locator('.terminal-node')).toHaveCount(2)
      await expect(sibling.locator('.xterm')).toBeVisible()
      const siblingId = await sibling.evaluate(
        el => el.closest('.react-flow__node')!.getAttribute('data-id')!,
      )
      await expect
        .poll(() =>
          window.evaluate(
            id =>
              window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)
                ?.rendererStructuralKind,
            siblingId,
          ),
        )
        .toBe('webgl')
      // Focus forces a real WebGL redraw of the unchanged sibling model/texture coordinates.
      await terminal.locator('.xterm-helper-textarea').focus()
      await window.evaluate(
        () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      const after = await screen.screenshot({ style: captureStyle })
      await test
        .info()
        .attach(`glyphs-after-creation-${round}`, { body: after, contentType: 'image/png' })
      expect(
        await haveIdenticalPixels(window, before, after),
        'Creating a sibling must not change existing glyph pixels',
      ).toBe(true)
      await sibling.locator('.terminal-node__close').click()
      await expect(window.locator('.terminal-node')).toHaveCount(1)
    }
    /* eslint-enable no-await-in-loop */
    await terminal.locator('.xterm-helper-textarea').focus()
    await window.evaluate(
      () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const afterFinalClose = await screen.screenshot({ style: captureStyle })
    await test
      .info()
      .attach('glyphs-after-final-close', { body: afterFinalClose, contentType: 'image/png' })
    expect(
      await haveIdenticalPixels(window, before, afterFinalClose),
      'Closing the final sibling must not change existing glyph pixels',
    ).toBe(true)
  } finally {
    await electronApp.close()
  }
})
