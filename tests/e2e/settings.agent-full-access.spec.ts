import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

test('a new install starts with full access off and explains both states', async () => {
  const { electronApp, window } = await launchApp()
  try {
    // No saved settings at all: what a new install sees. Saved settings without the key
    // (as every other seed writes) keep the legacy full access.
    await seedWorkspaceState(window, {
      activeWorkspaceId: 'full-access-project',
      workspaces: [
        { id: 'full-access-project', name: 'Project', path: testWorkspacePath, nodes: [] },
      ],
    })
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-agent').click()

    const toggle = window.getByTestId('settings-agent-full-access')
    const help = window.getByTestId('settings-agent-full-access-help')
    await expect(toggle).not.toBeChecked()
    await expect(help).toContainText('ask before running commands')
    await expect(help).not.toHaveAttribute('data-tone', 'warning')

    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect(help).toContainText('without asking')
    await expect(help).toHaveAttribute('data-tone', 'warning')
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          return raw ? JSON.parse(raw).settings?.agentFullAccess : null
        }),
      )
      .toBe(true)
  } finally {
    await electronApp.close()
  }
})
