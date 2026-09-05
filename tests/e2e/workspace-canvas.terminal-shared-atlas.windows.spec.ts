import { expect, test } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test('preserves existing glyph pixels when another WebGL terminal is created and closed', async () => {
  test.skip(process.platform !== 'win32', 'Windows WebGL at 150% scale')
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 1.5 })
  try {
    await clearAndSeedWorkspace(window, [
      {
        id: 'atlas-owner',
        title: 'atlas-owner',
        position: { x: 350, y: 80 },
        width: 520,
        height: 340,
      },
    ])
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
      expect(after.equals(before), 'Creating a sibling must not change existing glyph pixels').toBe(
        true,
      )
      await sibling.locator('.terminal-node__close').click()
      await expect(window.locator('.terminal-node')).toHaveCount(1)
    }
    /* eslint-enable no-await-in-loop */
  } finally {
    await electronApp.close()
  }
})
