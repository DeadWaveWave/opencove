import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

export async function sendAppKey(app: ElectronApplication, key: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, keyCode) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    const modifiers = process.platform === 'darwin' ? ['meta'] : ['control']
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }, key)
}

export function applicationShortcutTests(): void {
  for (const kind of ['terminal', 'note'] as const) {
    test(`close shortcut closes a ${kind} while typing without canvas selection`, async () => {
      const { electronApp, window } = await launchApp()
      try {
        await clearAndSeedWorkspace(window, [
          {
            id: 'input-close',
            title: 'Input close',
            position: { x: 50, y: 80 },
            width: 400,
            height: 280,
            kind,
            ...(kind === 'note' ? { task: { text: '' } } : {}),
          },
          {
            id: 'input-keep',
            title: 'Input keep',
            position: { x: 500, y: 80 },
            width: 400,
            height: 280,
          },
        ])
        const target = window.locator('.react-flow__node[data-id="input-close"]')
        const inputElement = target.locator(
          kind === 'terminal' ? '.xterm-helper-textarea' : '[data-testid="note-node-textarea"]',
        )
        await target
          .locator(kind === 'terminal' ? '.xterm' : '[data-testid="note-node-textarea"]')
          .click()
        await expect(inputElement).toBeFocused()
        await window.keyboard.type('echo close-input-probe')
        await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
        const received = await electronApp.evaluateHandle(({ BrowserWindow }) => {
          const inputs: Electron.Input[] = []
          BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => {
            inputs.push(input)
          })
          return inputs
        })
        await sendAppKey(electronApp, 'w')
        expect(
          await received.evaluate(inputs => inputs.some(input => input.key.toLowerCase() === 'w')),
        ).toBe(true)
        await expect(target).toHaveCount(0)
        await expect(window.locator('.react-flow__node[data-id="input-keep"]')).toBeVisible()
        await expect(window.locator('.workspace-canvas')).toBeVisible()
      } finally {
        await electronApp.close()
      }
    })
  }

  test('close shortcut keeps an empty canvas alive and closes only the selected node', async () => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [])
      await sendAppKey(electronApp, 'w')
      await expect(window.locator('.workspace-canvas')).toBeVisible()
      await clearAndSeedWorkspace(window, [
        {
          id: 'close-one',
          title: 'Close one',
          position: { x: 50, y: 80 },
          width: 400,
          height: 280,
        },
        { id: 'keep-one', title: 'Keep one', position: { x: 500, y: 80 }, width: 400, height: 280 },
      ])
      const selected = window.locator('.react-flow__node[data-id="close-one"]')
      await selected.locator('.terminal-node__header').click()
      await expect(selected).toHaveClass(/selected/)
      await sendAppKey(electronApp, 'w')
      await expect(selected).toHaveCount(0)
      await expect(window.locator('.react-flow__node[data-id="keep-one"]')).toBeVisible()
      await sendAppKey(electronApp, 'w')
      await expect(window.locator('.workspace-canvas')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('quit requires a second independent press', async () => {
    test.setTimeout(90_000)
    test.skip(process.platform !== 'darwin', 'Only macOS has a guarded quit shortcut')
    const userDataDir = await mkdtemp(join(tmpdir(), 'opencove-shortcut-quit-'))
    const { electronApp, window } = await launchApp({ userDataDir, cleanupUserDataDir: false })
    let appClosed = false
    electronApp.once('close', () => {
      appClosed = true
    })
    try {
      await clearAndSeedWorkspace(window, [])
      const diagnostics = await electronApp.evaluateHandle(({ app, BrowserWindow }) => {
        const state = { beforeQuit: 0, inputs: [] as Electron.Input[] }
        app.on('before-quit', () => {
          state.beforeQuit += 1
        })
        BrowserWindow.getAllWindows()[0].webContents.on('before-input-event', (_event, input) => {
          if (state.inputs.length < 10) {
            state.inputs.push(input)
          }
        })
        return state
      })
      await sendAppKey(electronApp, 'q')
      expect(await diagnostics.evaluate(state => state.beforeQuit)).toBe(0)
      await expect(window.getByText(/again within|秒内再次/)).toBeVisible()
      await expect(window.locator('.workspace-canvas')).toBeVisible()
      // Existing Worker shutdown allows 37.5s, in addition to renderer persistence flush.
      const closed = electronApp.waitForEvent('close', { timeout: 60_000 })
      await sendAppKey(electronApp, 'q')
      const quitState = await diagnostics.jsonValue()
      await test.info().attach('quit-input-events', {
        body: JSON.stringify(quitState),
        contentType: 'application/json',
      })
      expect(quitState.beforeQuit).toBeGreaterThan(0)
      await closed
    } finally {
      if (!appClosed) {
        await electronApp.close()
      }
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
}
