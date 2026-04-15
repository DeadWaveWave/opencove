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

  test('persists the selected terminal environment', async ({ browserName }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      await resetWorkspaceState(window)
      await window.reload({ waitUntil: 'domcontentloaded' })

      await expect
        .poll(async () => {
          const result = await readAvailableTerminalProfiles(window)
          return result.profiles.length
        })
        .toBeGreaterThan(0)

      const profileResult = await readAvailableTerminalProfiles(window)

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
      const terminalProfileTrigger = window.locator(
        '[data-testid="settings-terminal-profile-trigger"]',
      )
      await expect(terminalProfileTrigger).toBeVisible()

      await terminalProfileTrigger.click()
      const terminalProfileMenu = window.locator('[data-testid="settings-terminal-profile-menu"]')
      await expect(terminalProfileMenu).toBeVisible()

      const dropdownScreenshotPath = testInfo.outputPath('windows-terminal-profile-dropdown.png')
      await window.screenshot({ path: dropdownScreenshotPath })
      await testInfo.attach('windows-terminal-profile-dropdown', {
        path: dropdownScreenshotPath,
        contentType: 'image/png',
      })

      await terminalProfileMenu
        .locator(`[data-cove-select-option-value="${selectedProfile.id}"]`)
        .click()
      await expect(terminalProfileSelect).toHaveValue(selectedProfile.id)
      await window.locator('.settings-panel__close').click()

      await expect
        .poll(async () => await readPersistedTerminalProfileId(window))
        .toBe(selectedProfile.id)

      await window.reload({ waitUntil: 'domcontentloaded' })

      await settingsButton.click({ noWaitAfter: true })
      await canvasNav.click()
      await expect(terminalProfileSelect).toHaveValue(selectedProfile.id)
      await expect(terminalProfileTrigger).toContainText(selectedProfile.label)
    } finally {
      await electronApp.close()
    }
  })

  test('uses the renderer header as the single visible title bar owner', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      const chromeMetrics = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0]
        if (!mainWindow) {
          return null
        }

        const bounds = mainWindow.getBounds()
        const contentBounds = mainWindow.getContentBounds()
        return {
          topInset: contentBounds.y - bounds.y,
          verticalFrameDelta: bounds.height - contentBounds.height,
        }
      })

      expect(chromeMetrics).not.toBeNull()
      expect(chromeMetrics?.topInset ?? Number.POSITIVE_INFINITY).toBeLessThan(12)

      await expect(window.locator('.app-header')).toBeVisible()

      const headerScreenshotPath = testInfo.outputPath('windows-single-header.png')
      await window.screenshot({ path: headerScreenshotPath })
      await testInfo.attach('windows-single-header', {
        path: headerScreenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
