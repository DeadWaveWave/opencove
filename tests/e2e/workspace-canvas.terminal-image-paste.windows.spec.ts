import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { buildNodeEvalCommand } from './workspace-canvas.testUtils'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

test.describe('Terminal image paste (Windows)', () => {
  test.skip(process.platform !== 'win32', 'Windows keyboard integration')
  for (const provider of ['pi', 'kimi', 'codex', 'claude-code'] as const) {
    test(`${provider} receives its native image binding for Alt+V and Ctrl+V`, async () => {
      const { electronApp, window } = await launchApp()
      try {
        const node = {
          id: 'paste-image',
          title: 'Image paste',
          position: { x: 120, y: 120 },
          width: 640,
          height: 360,
          terminalProviderHint: provider,
        }
        await clearAndSeedWorkspace(window, [node])
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
        const sequence = provider === 'pi' || provider === 'claude-code' ? '1b76' : '16'
        await window.keyboard.press('Alt+V')
        await expect(terminal).toContainText(`INPUT_HEX:${sequence}`)
        await window.keyboard.press('Control+V')
        await expect
          .poll(async () => {
            const text = await terminal.locator('.terminal-node__transcript').textContent()
            return text?.split(`INPUT_HEX:${sequence}`).length
          })
          .toBe(3)
        await electronApp.evaluate(({ clipboard }) => clipboard.writeText('PASTE_TEXT'))
        await window.keyboard.press('Control+V')
        await expect(terminal).toContainText(
          'INPUT_HEX:1b5b3230307e50415354455f544558541b5b3230317e',
        )
        await window.keyboard.press('Control+C')
      } finally {
        await electronApp.close()
      }
    })
  }
})
