import { expect, test, type Locator } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'

async function waitForVisualState(locator: Locator): Promise<void> {
  await locator.evaluate(async element => {
    const animations = element.getAnimations({ subtree: true })
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })
}

test.describe('Control Center', () => {
  test('opens and toggles theme and minimap without a sidebar control', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-control-center',
        workspaces: [
          {
            id: 'workspace-control-center',
            name: 'workspace-control-center',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
        settings: {
          uiTheme: 'dark',
          uiFontSize: 18,
          isPrimarySidebarCollapsed: false,
        },
      })

      const pane = window.locator('.workspace-canvas .react-flow__pane')
      await expect(pane).toBeVisible()

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await expect(controlCenterButton).toBeVisible()
      await controlCenterButton.click()

      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      await waitForVisualState(controlCenter)

      const darkVisuals = await controlCenter.evaluate(element => {
        const title = element.querySelector<HTMLElement>('.control-center__title')
        const rowLabel = element.querySelector<HTMLElement>('.control-center__row-label')
        const rowStatus = element.querySelector<HTMLElement>('.control-center__row-status')
        const toggleTrack = element.querySelector<HTMLElement>('.cove-toggle__track')
        const toggleThumb = element.querySelector<HTMLElement>('.cove-toggle__thumb')
        if (!title || !rowLabel || !rowStatus || !toggleTrack || !toggleThumb) {
          throw new Error('Control Center visual primitives are missing')
        }

        const bounds = element.getBoundingClientRect()
        return {
          width: bounds.width,
          height: bounds.height,
          titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
          rowLabelFontSize: Number.parseFloat(getComputedStyle(rowLabel).fontSize),
          rowStatusFontSize: Number.parseFloat(getComputedStyle(rowStatus).fontSize),
          toggleTrack: getComputedStyle(toggleTrack).backgroundColor,
          toggleThumb: getComputedStyle(toggleThumb).backgroundColor,
        }
      })
      expect(darkVisuals.width).toBeCloseTo(360, 0)
      expect(darkVisuals.height).toBeGreaterThanOrEqual(330)
      expect(darkVisuals.height).toBeLessThanOrEqual(360)
      expect(darkVisuals.titleFontSize / darkVisuals.rowLabelFontSize).toBeGreaterThanOrEqual(1.1)
      expect(darkVisuals.titleFontSize / darkVisuals.rowLabelFontSize).toBeLessThanOrEqual(1.2)
      expect(darkVisuals.rowLabelFontSize / darkVisuals.rowStatusFontSize).toBeGreaterThanOrEqual(
        1.2,
      )
      expect(darkVisuals.toggleTrack).toBe('rgb(91, 156, 242)')
      expect(darkVisuals.toggleThumb).toBe('rgb(247, 248, 250)')

      const darkScreenshotPath = testInfo.outputPath('control-center-dark.png')
      await window.screenshot({ path: darkScreenshotPath })
      await testInfo.attach('control-center-dark', {
        path: darkScreenshotPath,
        contentType: 'image/png',
      })

      await window.locator('[data-testid="control-center-theme-light"]').click()
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')
      await expect(window.locator('[data-testid="control-center-theme-light"]')).toBeChecked()
      await expect(window.locator('[data-testid="control-center-current-theme"]')).toContainText(
        'Light',
      )
      await waitForVisualState(controlCenter)
      const lightToggleTrack = await controlCenter
        .locator('.cove-toggle__track')
        .first()
        .evaluate(element => getComputedStyle(element).backgroundColor)
      await expect(lightToggleTrack).toBe('rgb(47, 127, 241)')

      const lightScreenshotPath = testInfo.outputPath('control-center-light.png')
      await window.screenshot({ path: lightScreenshotPath })
      await testInfo.attach('control-center-light', {
        path: lightScreenshotPath,
        contentType: 'image/png',
      })

      await expect(window.locator('[data-testid="control-center-toggle-sidebar"]')).toHaveCount(0)

      const minimap = window.locator('.workspace-canvas__minimap')
      const wasMinimapVisible = (await minimap.count()) > 0
      await window.locator('[data-testid="control-center-toggle-minimap"]').click()
      await expect(minimap).toHaveCount(wasMinimapVisible ? 0 : 1)
    } finally {
      await electronApp.close()
    }
  })

  test('opens settings from Control Center', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-control-center-settings',
        workspaces: [
          {
            id: 'workspace-control-center-settings',
            name: 'workspace-control-center-settings',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await expect(controlCenterButton).toBeVisible()
      await controlCenterButton.click()

      await expect(window.locator('[data-testid="control-center"]')).toBeVisible()
      await window.locator('[data-testid="control-center-open-settings"]').click()

      const settingsPanel = window.locator('.settings-panel')
      const settingsSearch = window.locator('[data-testid="settings-panel-search"]')
      await expect(settingsPanel).toBeVisible()
      await expect(window.locator('[data-testid="control-center"]')).toHaveCount(0)
      await expect(settingsSearch).toBeFocused()
      await window.waitForTimeout(100)
      await expect(settingsSearch).toBeFocused()

      await window.keyboard.press('Escape')
      await expect(settingsPanel).toBeHidden()
      await expect(window.locator('[data-testid="app-header-settings"]')).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })

  test('exposes all themes with non-modal switch semantics and restores focus', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-control-center-semantics',
        workspaces: [
          {
            id: 'workspace-control-center-semantics',
            name: 'workspace-control-center-semantics',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
        settings: {
          uiTheme: 'ember',
          isPrimarySidebarCollapsed: false,
        },
      })

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await controlCenterButton.click()

      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      await expect(controlCenter).toHaveAttribute('role', 'dialog')
      await expect(controlCenter).not.toHaveAttribute('aria-modal', 'true')

      const themeInputs = controlCenter.locator('input[name="control-center-theme"]')
      await expect(themeInputs).toHaveCount(5)
      await expect(window.locator('[data-testid="control-center-theme-ember"]')).toBeChecked()
      await expect(window.locator('[data-testid="control-center-current-theme"]')).toContainText(
        'Ember',
      )
      await expect(window.locator('[data-testid="control-center-toggle-sidebar"]')).toHaveCount(0)

      const minimapInput = window
        .locator('[data-testid="control-center-toggle-minimap"]')
        .locator('input')
      await expect(minimapInput).toHaveAttribute('role', 'switch')
      await waitForVisualState(controlCenter)

      const screenshotPath = testInfo.outputPath('control-center-ember.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('control-center-ember', {
        path: screenshotPath,
        contentType: 'image/png',
      })

      await window.keyboard.press('Escape')
      await expect(controlCenter).toHaveCount(0)
      await expect(controlCenterButton).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })

  test('stays usable in a narrow viewport with large UI text', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      await window.setViewportSize({ width: 360, height: 720 })
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-control-center-narrow',
        workspaces: [
          {
            id: 'workspace-control-center-narrow',
            name: 'workspace-control-center-narrow',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
        settings: {
          uiTheme: 'dark',
          uiFontSize: 24,
          isPrimarySidebarCollapsed: true,
        },
      })

      await window.locator('[data-testid="app-header-control-center"]').click()
      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      await expect(controlCenter.locator('input[name="control-center-theme"]')).toHaveCount(5)
      await waitForVisualState(controlCenter)

      const metrics = await controlCenter.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        }
      })
      expect(metrics.left).toBeGreaterThanOrEqual(8)
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth - 8)
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)

      const screenshotPath = testInfo.outputPath('control-center-narrow-dark.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('control-center-narrow-dark', {
        path: screenshotPath,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })
})
