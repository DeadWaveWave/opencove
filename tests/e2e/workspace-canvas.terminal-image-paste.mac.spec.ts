import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { buildNodeEvalCommand } from './workspace-canvas.testUtils'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

test.describe('Terminal image paste (macOS)', () => {
  test.skip(process.platform !== 'darwin', 'macOS keyboard integration')
  test('maps Cmd+V images to the native TUI binding and preserves text paste', async () => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'paste-image',
          title: 'Image paste',
          position: { x: 120, y: 120 },
          width: 640,
          height: 360,
        },
      ])
      const terminal = window.locator('.terminal-node').first()
      await terminal.locator('.xterm').click()
      await window.keyboard.type(
        buildNodeEvalCommand(`
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', chunk => {
          process.stdout.write('INPUT_HEX:' + chunk.toString('hex') + '\\r\\n');
          if (chunk.includes(3)) process.exit();
        });
        process.stdout.write('\\x1b[?2004hPASTE_READY\\r\\n');
      `),
      )
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText('PASTE_READY')
      await electronApp.evaluate(({ clipboard, nativeImage }, dataUrl) => {
        clipboard.clear()
        clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
      }, png)
      await window.keyboard.press('Meta+V')
      await expect(terminal).toContainText('INPUT_HEX:16')
      await expect(window.locator('.image-node')).toHaveCount(0)
      await electronApp.evaluate(({ clipboard }) => clipboard.writeText('PASTE_TEXT'))
      await window.keyboard.press('Meta+V')
      await expect(terminal).toContainText('INPUT_HEX:1b5b3230307e50415354455f544558541b5b3230317e')
      await window.keyboard.press('Control+C')
    } finally {
      await electronApp.close()
    }
  })
})
