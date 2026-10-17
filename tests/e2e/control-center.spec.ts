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
          uiTheme: 'pixel',
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
        const rowIcon = element.querySelector<HTMLElement>('.control-center__row-icon')
        const segments = element.querySelectorAll<HTMLElement>('.control-center__segments')
        const toggleTrack = element.querySelector<HTMLElement>('.cove-toggle__track')
        const toggleThumb = element.querySelector<HTMLElement>('.cove-toggle__thumb')
        if (
          !title ||
          !rowLabel ||
          !rowIcon ||
          segments.length !== 2 ||
          !toggleTrack ||
          !toggleThumb
        ) {
          throw new Error('Control Center visual primitives are missing')
        }

        const bounds = element.getBoundingClientRect()
        return {
          width: bounds.width,
          height: bounds.height,
          titleFontSize: Number.parseFloat(getComputedStyle(title).fontSize),
          rowLabelFontSize: Number.parseFloat(getComputedStyle(rowLabel).fontSize),
          rowIconBackground: getComputedStyle(rowIcon).backgroundColor,
          rowStatusCount: element.querySelectorAll('.control-center__row-status').length,
          segmentWidths: Array.from(segments, segment => segment.getBoundingClientRect().width),
          radius: getComputedStyle(element).borderTopLeftRadius,
          overflow: element.scrollWidth > element.clientWidth,
          toggleTrack: getComputedStyle(toggleTrack).backgroundColor,
          toggleThumb: getComputedStyle(toggleThumb).backgroundColor,
        }
      })
      expect(darkVisuals.width).toBeCloseTo(360, 0)
      expect(darkVisuals.height).toBeGreaterThanOrEqual(260)
      expect(darkVisuals.height).toBeLessThanOrEqual(480)
      expect(darkVisuals.titleFontSize).toBeCloseTo(darkVisuals.rowLabelFontSize, 1)
      expect(darkVisuals.rowIconBackground).toBe('rgba(0, 0, 0, 0)')
      expect(darkVisuals.rowStatusCount).toBe(0)
      // Family and mode controls span the panel's width.
      expect(darkVisuals.segmentWidths.every(width => width > darkVisuals.width - 40)).toBe(true)
      expect(darkVisuals.radius).toBe('8px')
      expect(darkVisuals.overflow).toBe(false)
      expect(darkVisuals.toggleTrack).not.toBe(darkVisuals.toggleThumb)

      const darkScreenshotPath = testInfo.outputPath('control-center-pixel.png')
      await window.screenshot({ path: darkScreenshotPath })
      await testInfo.attach('control-center-pixel', {
        path: darkScreenshotPath,
        contentType: 'image/png',
      })

      await window.locator('[data-testid="control-center-theme-mode-light"]').check()
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', 'pixel-light')
      await expect(
        window.locator('[data-testid="control-center-theme-family-pixel"]'),
      ).toBeChecked()
      await waitForVisualState(controlCenter)
      const lightToggleTrack = await controlCenter
        .locator('.cove-toggle__track')
        .first()
        .evaluate(element => getComputedStyle(element).backgroundColor)
      expect(lightToggleTrack).not.toBe(darkVisuals.toggleTrack)

      const lightScreenshotPath = testInfo.outputPath('control-center-pixel-light.png')
      await window.screenshot({ path: lightScreenshotPath })
      await testInfo.attach('control-center-pixel-light', {
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
        // A saved choice of the retired Ember theme loads as Cove dark.
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

      const themeInputs = controlCenter.getByRole('radio')
      await expect(themeInputs).toHaveCount(5)
      await expect(window.locator('[data-testid="control-center-theme-family-cove"]')).toBeChecked()
      await expect(window.locator('[data-testid="control-center-theme-mode-dark"]')).toBeChecked()
      await expect(window.locator('html')).toHaveAttribute('data-cove-family', 'cove')
      await expect(window.locator('[data-testid="control-center-toggle-sidebar"]')).toHaveCount(0)

      const minimapInput = window
        .locator('[data-testid="control-center-toggle-minimap"]')
        .locator('input')
      await expect(minimapInput).toHaveAttribute('role', 'switch')
      await waitForVisualState(controlCenter)

      const screenshotPath = testInfo.outputPath('control-center-cove-from-ember.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('control-center-cove-from-ember', {
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

  test('uses a mobile sheet with large UI text and hands focus to Settings', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      await window.setViewportSize({ width: 320, height: 720 })
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
          uiTheme: 'pixel-light',
          uiFontSize: 24,
          isPrimarySidebarCollapsed: true,
        },
      })

      await window.locator('[data-testid="app-header-control-center"]').click()
      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      // Two families plus Pixel's two modes (it has no follow-system mode).
      await expect(controlCenter.getByRole('radio')).toHaveCount(4)
      await expect(controlCenter).toHaveAttribute('aria-modal', 'true')
      await expect(window.locator('.app-shell')).toHaveJSProperty('inert', true)
      await waitForVisualState(controlCenter)

      const metrics = await controlCenter.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          bottom: rect.bottom,
          viewportHeight: window.innerHeight,
          touchHeights: Array.from(
            element.querySelectorAll<HTMLElement>(
              '.control-center__row, .control-center__theme-option, .control-center__settings, .control-center__close',
            ),
            control => control.getBoundingClientRect().height,
          ),
          labelsFit: Array.from(
            element.querySelectorAll<HTMLElement>(
              '.control-center__theme-label, .control-center__row-label',
            ),
          ).every(label => label.scrollWidth <= label.clientWidth),
        }
      })
      expect(metrics.left).toBeGreaterThanOrEqual(8)
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth - 8)
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight - 8)
      expect(metrics.bottom).toBeGreaterThanOrEqual(metrics.viewportHeight - 12)
      expect(Math.min(...metrics.touchHeights)).toBeGreaterThanOrEqual(43.99)
      expect(metrics.labelsFit).toBe(true)

      const screenshotPath = testInfo.outputPath('control-center-narrow-pixel-light.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('control-center-narrow-pixel-light', {
        path: screenshotPath,
        contentType: 'image/png',
      })

      const settingsButton = controlCenter.getByTestId('control-center-open-settings')
      await settingsButton.focus()
      await window.keyboard.press('Tab')
      await expect(controlCenter.getByTestId('control-center-close')).toBeFocused()
      await window.keyboard.press('Shift+Tab')
      await expect(settingsButton).toBeFocused()
      await window.keyboard.press('Escape')
      await expect(controlCenter).toHaveCount(0)
      const trigger = window.getByTestId('app-header-control-center')
      await expect(trigger).toBeFocused()
      await expect(window.locator('.app-shell')).toHaveJSProperty('inert', false)
      await trigger.click()
      await settingsButton.click()
      await expect(window.getByTestId('settings-panel-close')).toBeFocused()
      await expect(controlCenter).toHaveCount(0)
      await window.waitForTimeout(100)
      await expect(window.getByTestId('settings-panel-close')).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })
})
