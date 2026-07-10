import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'
import { launchApp, selectCoveOption } from './workspace-canvas.helpers'

const NARROW_WINDOW_SIZE = { width: 720, height: 650 }

const PRIMARY_SETTINGS_PAGE_CAPTURES = [
  { id: 'general', navTestId: 'settings-section-nav-general' },
  { id: 'appearance', navTestId: 'settings-section-nav-appearance' },
  { id: 'notifications', navTestId: 'settings-section-nav-notifications' },
  { id: 'canvas-windows', navTestId: 'settings-section-nav-canvas' },
  { id: 'agent', navTestId: 'settings-section-nav-agent' },
  { id: 'tasks-shortcuts', navTestId: 'settings-section-nav-task-configuration' },
  { id: 'worker', navTestId: 'settings-section-nav-worker' },
  { id: 'integrations', navTestId: 'settings-section-nav-integrations' },
  { id: 'advanced', navTestId: 'settings-section-nav-experimental' },
] as const

async function openSettings(window: Page): Promise<Locator> {
  const settingsTrigger = window.locator('[data-testid="app-header-settings"]')
  await expect(settingsTrigger).toBeVisible()
  await settingsTrigger.click({ noWaitAfter: true })

  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function readHeadingText(heading: Locator): Promise<string> {
  const text = (await heading.textContent())?.trim() ?? ''
  expect(text.length).toBeGreaterThan(0)
  return text
}

async function expectNoHorizontalOverflow(locator: Locator, label: string): Promise<void> {
  const metrics = await locator.evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))

  expect(
    metrics.scrollWidth,
    `${label} overflowed horizontally: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1)
}

async function pressKeyTimes(locator: Locator, key: string, remaining: number): Promise<void> {
  if (remaining <= 0) {
    return
  }

  await locator.press(key)
  await pressKeyTimes(locator, key, remaining - 1)
}

async function selectThemeAndAttachPanel(
  window: Page,
  dialog: Locator,
  theme: 'dark' | 'light',
  testInfo: TestInfo,
): Promise<void> {
  await selectTheme(window, theme)

  const screenshot = await dialog.screenshot({ animations: 'disabled' })
  await testInfo.attach(`settings-panel-${theme}`, {
    body: screenshot,
    contentType: 'image/png',
  })
}

async function selectTheme(window: Page, theme: 'dark' | 'light'): Promise<void> {
  await selectCoveOption(window, 'settings-ui-theme', theme)
  await expect
    .poll(async () => {
      return await window.evaluate(() => document.documentElement.dataset.coveTheme ?? null)
    })
    .toBe(theme)
}

async function verifyWorkerHierarchyAndAttach(
  window: Page,
  dialog: Locator,
  theme: 'dark' | 'light',
  testInfo: TestInfo,
): Promise<void> {
  await dialog.locator('[data-testid="settings-section-nav-appearance"]').click()
  await selectTheme(window, theme)
  await dialog.locator('[data-testid="settings-section-nav-worker"]').click()

  const runtime = dialog.getByRole('group', { name: 'Worker 运行', exact: true })
  const body = runtime.locator(':scope > .settings-panel__group-body')
  const workerMode = runtime.getByRole('group', { name: 'Worker 模式' })
  const cli = runtime.getByRole('group', { name: 'CLI', exact: true })
  const localWorker = runtime.getByRole('group', { name: '本机 Worker' })
  await expect(body).toHaveCount(1)
  await expect(workerMode).toBeVisible()
  await expect(cli.getByTestId('settings-worker-cli-status')).toBeVisible()
  await expect(localWorker.getByTestId('settings-worker-local-status')).toBeVisible()

  await expect(runtime.locator('.settings-panel__worker-module')).toHaveCount(0)

  const groupSurface = await body.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      overflow: style.overflow,
    }
  })
  expect(groupSurface.borderRadius).toBe('12px')
  expect(groupSurface.boxShadow).toContain('inset')
  expect(groupSurface.overflow).toBe('hidden')

  const moduleSurface = await workerMode.evaluate(element => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, borderRadius: style.borderRadius }
  })
  expect(moduleSurface).toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', borderRadius: '0px' })
  await expectNoHorizontalOverflow(
    dialog.locator('.settings-panel__content'),
    `${theme} Worker settings content`,
  )

  const screenshot = await dialog.screenshot({ animations: 'disabled' })
  await testInfo.attach(`settings-worker-hierarchy-${theme}`, {
    body: screenshot,
    contentType: 'image/png',
  })
}

async function capturePrimarySettingsPages(
  dialog: Locator,
  testInfo: TestInfo,
  pageIndex = 0,
): Promise<void> {
  const page = PRIMARY_SETTINGS_PAGE_CAPTURES[pageIndex]
  if (!page) {
    return
  }

  await dialog.locator(`[data-testid="${page.navTestId}"]`).click()
  const groups = dialog.locator('.settings-panel__group')
  await expect(groups.first()).toBeVisible()
  expect(
    await groups.evaluateAll(
      elements =>
        elements.filter(element => {
          const header = element.querySelector(':scope > .settings-panel__group-header')
          const heading = header?.querySelector(':scope > .settings-panel__group-title')
          return !header || !heading
        }).length,
    ),
  ).toBe(0)
  await expect(
    dialog.locator('.settings-panel__group-body .settings-panel__group-body'),
  ).toHaveCount(0)
  await expectNoHorizontalOverflow(
    dialog.locator('.settings-panel__content'),
    `${page.id} settings content`,
  )

  const screenshot = await dialog.screenshot({ animations: 'disabled' })
  await testInfo.attach(`settings-groups-${page.id}-dark`, {
    body: screenshot,
    contentType: 'image/png',
  })

  await capturePrimarySettingsPages(dialog, testInfo, pageIndex + 1)
}

async function resizeMainWindow(
  electronApp: ElectronApplication,
  requestedSize: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  await expect
    .poll(async () => {
      return await electronApp.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
      })
    })
    .toBe(true)

  return await electronApp.evaluate(({ BrowserWindow }, size) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) {
      throw new Error('Expected the OpenCove main BrowserWindow')
    }

    const currentBounds = mainWindow.getBounds()
    mainWindow.setBounds(
      {
        x: currentBounds.x,
        y: currentBounds.y,
        width: size.width,
        height: size.height,
      },
      false,
    )
    mainWindow.setContentSize(size.width, size.height, false)

    const [width, height] = mainWindow.getContentSize()
    return { width, height }
  }, requestedSize)
}

test.describe('Settings visual shell', () => {
  test('uses an accessible page-aware dialog and captures both themes', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      const dialog = await openSettings(window)
      await expect(dialog).toHaveAttribute('aria-modal', 'true')
      const heading = dialog.getByRole('heading', { level: 2 })
      const initialTitle = await readHeadingText(heading)
      await expect(dialog).toHaveAccessibleName(initialTitle)

      await dialog.locator('[data-testid="settings-section-nav-appearance"]').click()
      const appearanceTitle = await readHeadingText(heading)
      expect(appearanceTitle).not.toBe(initialTitle)
      await expect(dialog).toHaveAccessibleName(appearanceTitle)

      await expectNoHorizontalOverflow(dialog, 'settings dialog')
      await expectNoHorizontalOverflow(
        dialog.locator('.settings-panel__content-wrapper'),
        'settings content wrapper',
      )
      await expectNoHorizontalOverflow(
        dialog.locator('.settings-panel__content'),
        'settings scroll content',
      )

      await selectThemeAndAttachPanel(window, dialog, 'dark', testInfo)
      await selectThemeAndAttachPanel(window, dialog, 'light', testInfo)
    } finally {
      await electronApp.close()
    }
  })

  test('adapts navigation and keyboard search to a narrow window', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      const actualSize = await resizeMainWindow(electronApp, NARROW_WINDOW_SIZE)
      expect(Math.abs(actualSize.width - NARROW_WINDOW_SIZE.width)).toBeLessThanOrEqual(2)
      expect(Math.abs(actualSize.height - NARROW_WINDOW_SIZE.height)).toBeLessThanOrEqual(2)
      await expect
        .poll(async () => await window.evaluate(() => window.innerWidth))
        .toBe(actualSize.width)

      const dialog = await openSettings(window)
      const sidebar = dialog.locator('.settings-panel__sidebar')
      const contentWrapper = dialog.locator('.settings-panel__content-wrapper')
      await expect(sidebar).toBeVisible()
      await expect(sidebar.locator('.settings-panel__nav-sections')).toHaveCount(1)
      await expect(sidebar.locator('.settings-panel__nav-sections')).toBeHidden()
      await expect(
        sidebar.locator('[data-testid="settings-panel-page-selector-trigger"]'),
      ).toBeVisible()

      const sidebarBox = await sidebar.boundingBox()
      const contentBox = await contentWrapper.boundingBox()
      expect(sidebarBox).not.toBeNull()
      expect(contentBox).not.toBeNull()
      expect(sidebarBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
        contentBox?.y ?? Number.NEGATIVE_INFINITY,
      )

      const search = sidebar.locator('[data-testid="settings-panel-search"]')
      await expect(search).toBeVisible()
      await search.fill('e')
      const searchResults = sidebar.locator('[data-testid="settings-panel-search-results"]')
      const searchOptions = searchResults.getByRole('option')
      await expect(searchOptions).toHaveCount(8)
      await pressKeyTimes(search, 'ArrowDown', 8)
      const activeResultId = await search.getAttribute('aria-activedescendant')
      expect(activeResultId).toBeTruthy()
      const activeResultIsVisible = await searchResults.evaluate((results, resultId) => {
        const activeResult = resultId ? document.getElementById(resultId) : null
        if (!activeResult) {
          return false
        }

        const resultsRect = results.getBoundingClientRect()
        const activeRect = activeResult.getBoundingClientRect()
        return activeRect.top >= resultsRect.top && activeRect.bottom <= resultsRect.bottom
      }, activeResultId)
      expect(activeResultIsVisible).toBe(true)

      await search.press('Escape')
      await search.fill('theme')
      await search.press('ArrowDown')
      await search.press('Enter')
      await expect(dialog.locator('[data-testid="settings-ui-theme-trigger"]')).toBeVisible()

      await expectNoHorizontalOverflow(dialog, 'narrow settings dialog')
      await expectNoHorizontalOverflow(contentWrapper, 'narrow settings content wrapper')
      await expectNoHorizontalOverflow(
        dialog.locator('.settings-panel__content'),
        'narrow settings scroll content',
      )

      const screenshot = await dialog.screenshot({ animations: 'disabled' })
      await testInfo.attach('settings-panel-narrow', {
        body: screenshot,
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  })

  test('groups Worker controls into distinct modules in both themes', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      const dialog = await openSettings(window)
      await dialog.locator('[data-testid="settings-section-nav-general"]').click()
      await selectCoveOption(window, 'settings-language', 'zh-CN')
      await expect(dialog.locator('[data-testid="settings-language"]')).toHaveValue('zh-CN')

      await verifyWorkerHierarchyAndAttach(window, dialog, 'dark', testInfo)
      await verifyWorkerHierarchyAndAttach(window, dialog, 'light', testInfo)
    } finally {
      await electronApp.close()
    }
  })

  test('captures a consistent grouped hierarchy across every primary page', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      const dialog = await openSettings(window)
      await dialog.locator('[data-testid="settings-section-nav-general"]').click()
      await selectCoveOption(window, 'settings-language', 'zh-CN')
      await dialog.locator('[data-testid="settings-section-nav-appearance"]').click()
      await selectTheme(window, 'dark')

      await capturePrimarySettingsPages(dialog, testInfo)
    } finally {
      await electronApp.close()
    }
  })

  test('closes with Escape and restores focus to the settings trigger', async ({ browserName }) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
      const settingsTrigger = window.locator('[data-testid="app-header-settings"]')
      const dialog = await openSettings(window)
      const search = dialog.locator('[data-testid="settings-panel-search"]')

      await expect(window.locator('.app-shell')).toHaveAttribute('inert', '')
      await expect(search).toBeFocused()
      await search.press('Shift+Tab')
      expect(await dialog.evaluate(panel => panel.contains(document.activeElement))).toBe(true)

      await dialog.locator('[data-testid="settings-section-nav-appearance"]').click()
      const themeTrigger = dialog.locator('[data-testid="settings-ui-theme-trigger"]')
      await themeTrigger.focus()
      await themeTrigger.press('Enter')
      const themeMenu = window.locator('[data-testid="settings-ui-theme-menu"]')
      await expect(themeMenu).toBeVisible()
      expect(await themeMenu.evaluate(menu => menu.parentElement === document.body)).toBe(true)

      await window.keyboard.press('Escape')
      await expect(themeMenu).toBeHidden()
      await expect(dialog).toBeVisible()

      await window.keyboard.press('Escape')

      await expect(dialog).toBeHidden()
      await expect(window.locator('.app-shell')).not.toHaveAttribute('inert', '')
      await expect(settingsTrigger).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })
})
