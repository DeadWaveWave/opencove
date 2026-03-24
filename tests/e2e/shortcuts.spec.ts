import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const commandCenterModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

async function openShortcutsSettings(window: Page): Promise<void> {
  await window.locator('[data-testid="app-header-settings"]').click()
  await expect(window.locator('.settings-panel')).toBeVisible()

  await window.locator('[data-testid="settings-section-nav-shortcuts"]').click()
  await expect(window.locator('#settings-section-shortcuts')).toBeVisible()
}

async function closeSettings(window: Page): Promise<void> {
  await window.locator('.settings-panel__close').click()
  await expect(window.locator('.settings-panel')).toBeHidden()
}

test.describe('Shortcuts', () => {
  test('does not capture shortcuts in terminal by default, but can be disabled', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [
        {
          id: 'node-terminal-shortcuts',
          title: 'terminal-shortcuts',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal).toBeVisible()
      const xterm = terminal.locator('.xterm')
      await expect(xterm).toBeVisible()

      await xterm.click()
      const terminalInput = terminal.locator('.xterm-helper-textarea')
      await expect(terminalInput).toBeFocused()

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()

      await openShortcutsSettings(window)
      const disableToggle = window.locator(
        '[data-testid="settings-disable-shortcuts-when-terminal-focused"]',
      )
      await expect(disableToggle).toBeVisible()
      await disableToggle.setChecked(false)
      await closeSettings(window)

      await xterm.click()
      await expect(terminalInput).toBeFocused()

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(window.locator('[data-testid="command-center"]')).toBeVisible()
      await expect(window.locator('[data-testid="command-center-input"]')).toBeFocused()

      await window.keyboard.press('Escape')
      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()
    } finally {
      await electronApp.close()
    }
  })

  test('customizes command center shortcut and applies immediately', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      await openShortcutsSettings(window)

      const recordButton = window.locator(
        '[data-testid="settings-shortcut-record-commandCenter.toggle"]',
      )
      await expect(recordButton).toBeVisible()
      await recordButton.click()

      await window.keyboard.press(`${commandCenterModifier}+J`)

      const expectedKeycap = process.platform === 'darwin' ? '⌘J' : 'Ctrl J'
      await expect(
        window.locator('[data-testid="settings-shortcut-value-commandCenter.toggle"]'),
      ).toHaveText(expectedKeycap)

      await closeSettings(window)

      await expect(window.locator('.app-header__command-center-keycap')).toHaveText(expectedKeycap)

      await window.keyboard.press(`${commandCenterModifier}+P`)
      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()

      await window.keyboard.press(`${commandCenterModifier}+J`)
      await expect(window.locator('[data-testid="command-center"]')).toBeVisible()

      await window.keyboard.press(`${commandCenterModifier}+J`)
      await expect(window.locator('[data-testid="command-center"]')).toBeHidden()
    } finally {
      await electronApp.close()
    }
  })

  test('supports default shortcuts for settings and sidebar', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      await expect(window.locator('.workspace-sidebar')).toBeVisible()

      await window.keyboard.press(`${commandCenterModifier}+,`)
      await expect(window.locator('.settings-panel')).toBeVisible()
      await closeSettings(window)

      await window.keyboard.press(`${commandCenterModifier}+B`)
      await expect(window.locator('.workspace-sidebar')).toBeHidden()

      await window.keyboard.press(`${commandCenterModifier}+B`)
      await expect(window.locator('.workspace-sidebar')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('lists configurable workspace canvas shortcuts in settings', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      await openShortcutsSettings(window)

      await expect(
        window.locator('[data-testid="settings-shortcut-value-workspaceCanvas.createSpace"]'),
      ).toHaveText(process.platform === 'darwin' ? '⌘G' : 'Ctrl G')
      await expect(
        window.locator('[data-testid="settings-shortcut-value-workspaceCanvas.createNote"]'),
      ).toHaveText(process.platform === 'darwin' ? '⌘N' : 'Ctrl N')
      await expect(
        window.locator('[data-testid="settings-shortcut-value-workspaceCanvas.createTerminal"]'),
      ).toHaveText(process.platform === 'darwin' ? '⌘T' : 'Ctrl T')
      await expect(
        window.locator(
          '[data-testid="settings-shortcut-value-workspaceCanvas.cycleSpacesForward"]',
        ),
      ).toHaveText(process.platform === 'darwin' ? '⌘]' : 'Ctrl ]')
      await expect(
        window.locator(
          '[data-testid="settings-shortcut-value-workspaceCanvas.cycleSpacesBackward"]',
        ),
      ).toHaveText(process.platform === 'darwin' ? '⌘[' : 'Ctrl [')
      await expect(
        window.locator(
          '[data-testid="settings-shortcut-value-workspaceCanvas.cycleIdleSpacesForward"]',
        ),
      ).toHaveText(process.platform === 'darwin' ? '⇧⌘]' : 'Ctrl Shift ]')
      await expect(
        window.locator(
          '[data-testid="settings-shortcut-value-workspaceCanvas.cycleIdleSpacesBackward"]',
        ),
      ).toHaveText(process.platform === 'darwin' ? '⇧⌘[' : 'Ctrl Shift [')
    } finally {
      await electronApp.close()
    }
  })

  test('customizes workspace canvas note shortcut and applies immediately', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await clearAndSeedWorkspace(window, [])

      await openShortcutsSettings(window)

      const recordButton = window.locator(
        '[data-testid="settings-shortcut-record-workspaceCanvas.createNote"]',
      )
      await expect(recordButton).toBeVisible()
      await recordButton.click()

      await window.keyboard.press(`${commandCenterModifier}+J`)

      const expectedKeycap = process.platform === 'darwin' ? '⌘J' : 'Ctrl J'
      await expect(
        window.locator('[data-testid="settings-shortcut-value-workspaceCanvas.createNote"]'),
      ).toHaveText(expectedKeycap)

      await closeSettings(window)

      await window.keyboard.press(`${commandCenterModifier}+N`)
      await expect(window.locator('.note-node')).toHaveCount(0)

      await window.keyboard.press(`${commandCenterModifier}+J`)
      await expect(window.locator('.note-node')).toHaveCount(1)
    } finally {
      await electronApp.close()
    }
  })
})
