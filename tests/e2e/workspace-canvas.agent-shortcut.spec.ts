import { expect, test } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  launchApp,
  seededWorkspaceId,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('canvas shortcut starts the default Agent once and preserves terminal and input Select All', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(window, [], {
      settings: {
        defaultProvider: 'codex',
        disableAppShortcutsWhenTerminalFocused: false,
        nodeCreationPixelEffectEnabled: false,
        customModelEnabledByProvider: { codex: true },
        customModelByProvider: { codex: 'gpt-5.2-codex' },
        customModelOptionsByProvider: { codex: ['gpt-5.2-codex'] },
      },
    })
    const canvas = window.locator('.workspace-canvas')
    const pane = canvas.locator('.react-flow__pane')
    await pane.click({ position: { x: 320, y: 220 } })
    await expect(canvas).toBeFocused()
    await window.keyboard.down(modifier)
    await window.keyboard.down('a')
    await window.keyboard.down('a')
    await window.keyboard.up('a')
    await window.keyboard.up(modifier)

    const agent = window.locator('.terminal-node')
    await expect(agent).toHaveCount(1)
    await expect(agent).toContainText('[opencove-test-agent] codex new')
    await expect(agent.getByTestId('terminal-node-title-display')).toContainText('gpt-5.2-codex')
    await expect(window.getByTestId('workspace-agent-launcher')).toHaveCount(0)
    const terminalInput = agent.locator('.xterm-helper-textarea')
    await terminalInput.focus()
    await window.keyboard.press(`${modifier}+a`)
    await expect(terminalInput).toBeFocused()

    await agent.getByTestId('terminal-node-title-display').click()
    const title = agent.getByTestId('terminal-node-inline-title-input')
    await title.fill('A title selected for replacement')
    await window.keyboard.press(`${modifier}+a`)
    await expect
      .poll(() =>
        title.evaluate(input => {
          const field = input as HTMLInputElement
          return [field.selectionStart, field.selectionEnd, field.value.length]
        }),
      )
      .toEqual([0, 32, 32])
    await window.keyboard.insertText('Replacement title')
    await title.press('Enter')
    await expect(agent.getByTestId('terminal-node-title-display')).toHaveText('Replacement title')
    await expect(agent).toHaveCount(1)
    await testInfo.attach('agent-created-from-canvas-shortcut', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
  }
})

test('sidebar, settings and Space Explorer keep ownership of the shortcut', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(window, [], {
      settings: { defaultProvider: 'codex', disableAppShortcutsWhenTerminalFocused: false },
      spaces: [
        {
          id: 'agent-shortcut-space',
          name: 'Development',
          directoryPath: testWorkspacePath,
          nodeIds: [],
          rect: { x: 80, y: 80, width: 900, height: 600 },
        },
      ],
    })
    const canvas = window.locator('.workspace-canvas')
    const pane = canvas.locator('.react-flow__pane')
    const files = window.getByTestId('workspace-space-files-agent-shortcut-space')
    await files.click()
    const explorer = window.getByTestId('workspace-space-explorer')
    await expect(explorer).toBeVisible()
    await explorer.focus()
    await window.keyboard.press(`${modifier}+a`)
    await expect(explorer).toBeFocused()

    const sidebarProject = window.getByTestId(`workspace-item-${seededWorkspaceId}`)
    await sidebarProject.focus()
    await window.keyboard.press(`${modifier}+a`)
    await expect(sidebarProject).toBeFocused()

    await window.getByTestId('app-header-settings').click()
    await expect(window.locator('.settings-panel')).toBeVisible()
    await window.locator('.settings-panel__close').focus()
    await window.keyboard.press(`${modifier}+a`)
    await window.locator('.settings-panel__close').click()
    await expect(window.locator('.settings-panel')).toBeHidden()
    await expect(window.locator('.terminal-node')).toHaveCount(0)

    // A real blank-canvas click must reacquire scope after returning from another surface.
    await pane.click({ position: { x: 20, y: 260 } })
    await expect(canvas).toBeFocused()
    await window.keyboard.press(`${modifier}+a`)
    await expect(window.locator('.terminal-node')).toHaveCount(1)
    await expect(window.locator('.terminal-node')).toContainText('[opencove-test-agent] codex new')
    await testInfo.attach('canvas-shortcut-surface-ownership', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
  } finally {
    await electronApp.close()
  }
})
