import { expect, test, type Locator, type Page } from '@playwright/test'
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

async function seedControlCenterWorkspace(
  window: Page,
  id: string,
  settings: Record<string, unknown> = {},
): Promise<void> {
  await seedWorkspaceState(window, {
    activeWorkspaceId: id,
    workspaces: [{ id, name: id, path: testWorkspacePath, nodes: [] }],
    settings,
  })
}

test.describe('Control Center', () => {
  test('opens as a pixel window with appearances, quick switches and lines into Settings', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      // A saved choice of the retired Pixel theme loads as Cove dark.
      await seedControlCenterWorkspace(window, 'workspace-control-center', {
        uiTheme: 'pixel',
        uiFontSize: 18,
        isPrimarySidebarCollapsed: false,
      })
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await expect(controlCenterButton).toBeVisible()
      await controlCenterButton.click()

      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      await waitForVisualState(controlCenter)

      const visuals = await controlCenter.evaluate(element => {
        const body = element.querySelector<HTMLElement>('.control-center__body')
        const sections = element.querySelectorAll<HTMLElement>(
          '.control-center__section, .control-center__links',
        )
        const faces = element.querySelectorAll<HTMLElement>('.cove-toggle-tile__face')
        const thumbnails = element.querySelectorAll<SVGElement>(
          '.cove-appearance-picker__thumbnail',
        )
        if (!body || sections.length !== 3 || faces.length !== 3 || thumbnails.length !== 3) {
          throw new Error('Control Center pixel primitives are missing')
        }
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        return {
          width: bounds.width,
          height: bounds.height,
          clipPath: style.clipPath,
          radius: style.borderTopLeftRadius,
          ring: getComputedStyle(element, '::before').boxShadow,
          overflow: body.scrollWidth > body.clientWidth,
          // The first section opens under the caption; the others part on a dotted rule.
          rules: Array.from(sections, section => getComputedStyle(section).backgroundImage),
          faces: Array.from(faces, face => {
            const rect = face.getBoundingClientRect()
            return [rect.width, rect.height]
          }),
          thumbnailsRendering: Array.from(thumbnails, svg => svg.getAttribute('shape-rendering')),
        }
      })
      expect(visuals.width).toBeCloseTo(312, 0)
      expect(visuals.height).toBeLessThanOrEqual(600)
      expect(visuals.clipPath).toContain('polygon')
      expect(visuals.radius).toBe('0px')
      expect(visuals.ring).toContain('inset')
      expect(visuals.overflow).toBe(false)
      expect(visuals.rules[0]).toBe('none')
      expect(visuals.rules.slice(1).every(rule => rule.includes('linear-gradient'))).toBe(true)
      expect(visuals.faces).toEqual([
        [44, 44],
        [44, 44],
        [44, 44],
      ])
      expect(visuals.thumbnailsRendering).toEqual(['crispEdges', 'crispEdges', 'crispEdges'])

      // Only Cove's appearances; the look's finer choices live in Settings.
      await expect(controlCenter.getByRole('radio')).toHaveCount(3)
      await expect(controlCenter.getByRole('switch')).toHaveCount(0)
      await expect(window.getByTestId('control-center-theme-mode-dark')).toBeChecked()
      await expect(window.getByTestId('control-center-toggle-sidebar')).toHaveCount(0)

      const darkScreenshotPath = testInfo.outputPath('control-center-dark.png')
      await window.screenshot({ path: darkScreenshotPath })
      await testInfo.attach('control-center-dark', {
        path: darkScreenshotPath,
        contentType: 'image/png',
      })

      await window.getByTestId('control-center-theme-mode-light').check()
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'light')
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', 'light')
      await waitForVisualState(controlCenter)

      const lightScreenshotPath = testInfo.outputPath('control-center-light.png')
      await window.screenshot({ path: lightScreenshotPath })
      await testInfo.attach('control-center-light', {
        path: lightScreenshotPath,
        contentType: 'image/png',
      })

      const minimap = window.locator('.workspace-canvas__minimap')
      const wasMinimapVisible = (await minimap.count()) > 0
      const minimapTile = window.getByTestId('control-center-toggle-minimap')
      await expect(minimapTile).toHaveAttribute('aria-pressed', String(wasMinimapVisible))
      await minimapTile.click()
      await expect(minimap).toHaveCount(wasMinimapVisible ? 0 : 1)
      await expect(minimapTile).toHaveAttribute('aria-pressed', String(!wasMinimapVisible))

      const inAppTile = window.getByTestId('control-center-toggle-in-app-notifications')
      await expect(inAppTile).toHaveAttribute('aria-pressed', 'true')
      await inAppTile.click()
      await expect(inAppTile).toHaveAttribute('aria-pressed', 'false')
      const systemTile = window.getByTestId('control-center-toggle-system-notifications')
      await expect(systemTile).toHaveAttribute('aria-pressed', 'true')
      await systemTile.click()
      await expect(systemTile).toHaveAttribute('aria-pressed', 'false')
    } finally {
      await electronApp.close()
    }
  })

  test('opens all settings, or Notifications, from its lines', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedControlCenterWorkspace(window, 'workspace-control-center-settings')

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

      await controlCenterButton.click()
      await window.getByTestId('control-center-open-notification-settings').click()
      await expect(settingsPanel).toBeVisible()
      await expect(window.locator('[data-testid="control-center"]')).toHaveCount(0)
      // Notifications is a section of General: Settings opens there and scrolls it into view.
      await expect(window.getByTestId('settings-section-nav-general')).toHaveClass(
        /settings-panel__nav-button--active/,
      )
      await expect(window.locator('#settings-section-notifications')).toBeInViewport()
    } finally {
      await electronApp.close()
    }
  })

  test('keeps non-modal semantics, loads a retired theme as Cove and restores focus', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      // A saved choice of the retired Ember theme loads as Cove dark.
      await seedControlCenterWorkspace(window, 'workspace-control-center-semantics', {
        uiTheme: 'ember',
        isPrimarySidebarCollapsed: false,
      })

      const controlCenterButton = window.locator('[data-testid="app-header-control-center"]')
      await controlCenterButton.click()

      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      await expect(controlCenter).toHaveAttribute('role', 'dialog')
      await expect(controlCenter).not.toHaveAttribute('aria-modal', 'true')

      await expect(controlCenter.getByRole('radio')).toHaveCount(3)
      await expect(window.getByTestId('control-center-theme-mode-dark')).toBeChecked()
      // Focus enters on the checked appearance.
      await expect(window.getByTestId('control-center-theme-mode-dark')).toBeFocused()
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')

      const tiles = controlCenter.locator('[data-cove-part="toggle-tile"]')
      await expect(tiles).toHaveCount(3)
      await Promise.all(
        [
          'control-center-toggle-minimap',
          'control-center-toggle-in-app-notifications',
          'control-center-toggle-system-notifications',
        ].map(testId =>
          expect(window.getByTestId(testId)).toHaveAttribute('aria-pressed', /true|false/),
        ),
      )
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
      // A saved choice of the retired Pixel Light theme loads as Cove light.
      await seedControlCenterWorkspace(window, 'workspace-control-center-narrow', {
        uiTheme: 'pixel-light',
        uiFontSize: 24,
        isPrimarySidebarCollapsed: true,
      })

      await window.locator('[data-testid="app-header-control-center"]').click()
      const controlCenter = window.locator('[data-testid="control-center"]')
      await expect(controlCenter).toBeVisible()
      await expect(controlCenter.getByRole('radio')).toHaveCount(3)
      await expect(window.getByTestId('control-center-theme-mode-light')).toBeChecked()
      await expect(controlCenter).toHaveAttribute('aria-modal', 'true')
      await expect(window.locator('.app-shell')).toHaveJSProperty('inert', true)
      await waitForVisualState(controlCenter)

      const metrics = await controlCenter.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const body = element.querySelector<HTMLElement>('.control-center__body')!
        return {
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth,
          scrollWidth: body.scrollWidth,
          clientWidth: body.clientWidth,
          bottom: rect.bottom,
          viewportHeight: window.innerHeight,
          background: getComputedStyle(element).backgroundColor,
          touchHeights: Array.from(
            element.querySelectorAll<HTMLElement>(
              '.control-center__link, .control-center__close, .cove-toggle-tile__face',
            ),
            control => control.getBoundingClientRect().height,
          ),
          labelsFit: Array.from(
            element.querySelectorAll<HTMLElement>(
              '.control-center__link-label, .cove-appearance-picker__label',
            ),
          ).every(label => label.scrollWidth <= label.clientWidth),
        }
      })
      expect(metrics.left).toBeGreaterThanOrEqual(8)
      expect(metrics.right).toBeLessThanOrEqual(metrics.viewportWidth - 8)
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
      expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight - 8)
      expect(metrics.bottom).toBeGreaterThanOrEqual(metrics.viewportHeight - 12)
      // A sheet has no acrylic of its own: it must not be see-through.
      expect(metrics.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(Math.min(...metrics.touchHeights)).toBeGreaterThanOrEqual(43.99)
      expect(metrics.labelsFit).toBe(true)

      const screenshotPath = testInfo.outputPath('control-center-narrow-light.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('control-center-narrow-light', {
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
