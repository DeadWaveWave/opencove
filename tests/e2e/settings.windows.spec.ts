import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

const windowsOnly = process.platform !== 'win32'

async function resetWorkspaceState(window: Awaited<ReturnType<typeof launchApp>>['window']) {
  const resetResult = await window.evaluate(async () => {
    return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
      raw: JSON.stringify({
        formatVersion: 1,
        activeWorkspaceId: null,
        workspaces: [],
        settings: {},
      }),
    })
  })

  if (!resetResult.ok) {
    throw new Error(
      `Failed to reset workspace state: ${resetResult.reason}: ${resetResult.error.code}${
        resetResult.error.debugMessage ? `: ${resetResult.error.debugMessage}` : ''
      }`,
    )
  }
}

async function readPersistedTerminalProfileId(
  window: Awaited<ReturnType<typeof launchApp>>['window'],
): Promise<string | null> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as {
        settings?: {
          defaultTerminalProfileId?: string | null
        }
      }

      const profileId = parsed.settings?.defaultTerminalProfileId
      return typeof profileId === 'string' && profileId.trim().length > 0 ? profileId : null
    } catch {
      return null
    }
  })
}

async function readAvailableTerminalProfiles(
  window: Awaited<ReturnType<typeof launchApp>>['window'],
) {
  return await window.evaluate(async () => {
    return await window.opencoveApi.pty.listProfiles()
  })
}

test.describe('Settings Terminal Profiles (Windows)', () => {
  test.skip(windowsOnly, 'Windows only')

  test('persists the selected terminal environment', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await resetWorkspaceState(window)
      await window.reload({ waitUntil: 'domcontentloaded' })

      const profileResult = await readAvailableTerminalProfiles(window)
      expect(profileResult.profiles.length).toBeGreaterThan(0)

      const selectedProfile =
        profileResult.profiles.find(profile => profile.id !== profileResult.defaultProfileId) ??
        profileResult.profiles[0]

      if (!selectedProfile) {
        throw new Error('Expected at least one available terminal profile on Windows')
      }

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click({ noWaitAfter: true })

      const canvasNav = window.locator('[data-testid="settings-section-nav-canvas"]')
      await expect(canvasNav).toBeVisible()
      await canvasNav.click()

      const terminalProfileSelect = window.locator('[data-testid="settings-terminal-profile"]')
      await expect(terminalProfileSelect).toBeVisible()
      await expect(terminalProfileSelect).toContainText(selectedProfile.label)

      await terminalProfileSelect.selectOption(selectedProfile.id)
      await window.locator('.settings-panel__close').click()

      await expect
        .poll(async () => await readPersistedTerminalProfileId(window))
        .toBe(selectedProfile.id)

      await window.reload({ waitUntil: 'domcontentloaded' })

      await settingsButton.click({ noWaitAfter: true })
      await canvasNav.click()
      await expect(terminalProfileSelect).toHaveValue(selectedProfile.id)
    } finally {
      await electronApp.close()
    }
  })
})
