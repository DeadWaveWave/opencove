import { expect, test, type Locator } from '@playwright/test'
import { buildAppState, createWorkspaceDir, openAuthedCanvas, writeAppState } from './helpers'

test.use({ hasTouch: true })

async function expectFits(surface: Locator) {
  await surface.evaluate(async element => {
    const root = element.closest('.cove-dialog-backdrop') ?? element
    await Promise.all(root.getAnimations({ subtree: true }).map(animation => animation.finished))
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  })
  const geometry = await surface.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.top).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
}

for (const theme of ['pixel', 'pixel-light']) {
  test(`quick surfaces support touch navigation in ${theme}`, async ({ page }, testInfo) => {
    const workspacePath = await createWorkspaceDir(`quick-${theme}`)
    await writeAppState(
      page.request,
      buildAppState({
        workspaceId: 'quick-surfaces',
        workspaceName: 'OpenCove',
        workspacePath,
        spaces: [
          {
            id: 'ui',
            name: 'ui/chrome',
            directoryPath: workspacePath,
            nodeIds: ['design-note'],
            rect: { x: 80, y: 80, width: 640, height: 480 },
          },
        ],
        nodes: [
          {
            id: 'design-note',
            kind: 'note',
            title: 'Design notes',
            position: { x: 160, y: 180 },
            width: 420,
            height: 280,
            text: 'Keep project navigation, search, and controls in one visual language.',
          },
        ],
        settings: { uiTheme: theme, language: 'zh-CN', isPrimarySidebarCollapsed: false },
      }),
    )
    await page.setViewportSize({ width: 1440, height: 960 })
    await openAuthedCanvas(page)
    await expect(page.locator('.workspace-canvas')).toBeVisible()
    const trigger = page.getByTestId('app-header-command-center')
    await trigger.click()
    const commands = page.getByTestId('command-center')
    await expectFits(commands)
    await expect(page.getByTestId('command-center-input')).toBeFocused()
    await testInfo.attach(`commands-${theme}-desktop`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByTestId('command-center-item-command:workspace-search').click()
    const search = page.getByTestId('workspace-search')
    await expectFits(search)
    await expect(page.getByTestId('workspace-search-input')).toBeFocused()
    await testInfo.attach(`search-${theme}-desktop`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByTestId('workspace-search-close').click()
    const controlsTrigger = page.getByTestId('app-header-control-center')
    await controlsTrigger.click()
    const controls = page.getByTestId('control-center')
    await expectFits(controls)
    await testInfo.attach(`controls-${theme}-desktop`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    await trigger.tap()
    await expect(page.getByTestId('command-center-close')).toBeFocused()
    await expectFits(commands)
    await testInfo.attach(`commands-${theme}-mobile`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByTestId('command-center-item-command:workspace-search').tap()
    await expect(page.getByTestId('workspace-search-close')).toBeFocused()
    await expect(search).toHaveAttribute('aria-modal', 'true')
    await expectFits(search)
    await testInfo.attach(`search-${theme}-mobile`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await search.getByRole('option').filter({ hasText: 'Keep project navigation' }).tap()
    await expect(search).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false)
    await controlsTrigger.tap()
    await expectFits(controls)
    await expect(controls).toHaveAttribute('aria-modal', 'true')
    await testInfo.attach(`controls-${theme}-mobile`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByTestId('control-center-open-settings').tap()
    await expect(page.getByTestId('settings-panel-close')).toBeFocused()
    await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false)
    await expect(page.locator('.workspace-main')).toHaveJSProperty('inert', true)
    await expectFits(page.getByTestId('settings-panel'))
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings-panel')).toHaveCount(0)
    await expect(page.locator('.workspace-main')).toHaveJSProperty('inert', false)
    await controlsTrigger.tap()
    await expect(controls).toBeVisible()
    await page.setViewportSize({ width: 320, height: 700 })
    await expectFits(controls)
    await page.getByTestId('control-center-close').tap()
    await trigger.tap()
    await expectFits(commands)
    await page.getByTestId('command-center-item-command:workspace-search').tap()
    await expectFits(search)
    await page.getByTestId('workspace-search-close').tap()
    await expect(trigger).toBeFocused()
  })
}
