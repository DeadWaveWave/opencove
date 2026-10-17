import { expect, test, type Locator, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import {
  buildAppState,
  createWorkspaceDir,
  invokeValue,
  openAuthedCanvas,
  writeAppState,
} from './helpers'
import { createThemePlugin, themeIdentity, themePluginId } from '../helpers/pluginThemeFixture'

test.use({ hasTouch: true })

async function openAppearance(page: Page) {
  await page.getByTestId('app-header-control-center').click()
  await page.getByTestId('control-center-open-settings').click()
  const mobileSelector = page.getByTestId('settings-panel-page-selector-trigger')
  if (await mobileSelector.isVisible()) {
    await mobileSelector.click()
    await page
      .getByTestId('settings-panel-page-selector-menu')
      .locator('[data-cove-select-option-value="appearance"]')
      .click()
  } else {
    await page.getByTestId('settings-section-nav-appearance').click()
  }
}

async function selectTheme(page: Page, id: string) {
  await openAppearance(page)
  await page.getByTestId(`settings-ui-theme-${id}`).click()
  await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', id)
  await page.getByTestId('settings-panel-close').click()
}

/** Plugin themes are chosen in Settings; the control center names the active one. */
async function selectPluginTheme(page: Page, id: string, title: string) {
  await selectTheme(page, id)
  await page.getByTestId('app-header-control-center').click()
  await expect(page.getByTestId('control-center-current-theme')).toHaveText(title)
  await page.getByTestId('control-center-close').click()
}

async function expectFits(surface: Locator) {
  const bounds = await surface.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      overflow: element.scrollWidth - element.clientWidth,
    }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(-1)
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1)
  expect(bounds.overflow).toBeLessThanOrEqual(1)
}

test('remote theme assets, typography and iframe context survive switches, recovery and narrow UI', async ({
  page,
}, info) => {
  test.setTimeout(150_000)
  const directory = await createThemePlugin({ includeFont: true })
  const workspacePath = await createWorkspaceDir('theme-studio')
  const projectId = 'web-theme-studio'
  const selectedTheme = themeIdentity('studio')
  let installed = false
  try {
    await writeAppState(
      page.request,
      buildAppState({
        workspaceId: projectId,
        workspaceName: 'Theme studio',
        workspacePath,
        spaces: [
          {
            id: 'theme-space',
            name: 'Workspace theme',
            directoryPath: workspacePath,
            nodeIds: ['theme-note'],
            rect: { x: 60, y: 70, width: 620, height: 420 },
          },
        ],
        nodes: [
          {
            id: 'theme-note',
            title: 'A themed window',
            kind: 'note',
            position: { x: 120, y: 140 },
            width: 380,
            height: 260,
            text: 'The Worker provides the theme assets.',
          },
        ],
        settings: {
          language: 'en',
          uiTheme: 'pixel',
          uiFontSize: 16,
          canvasInputMode: 'mouse',
          nodeCreationPixelEffectEnabled: false,
          isPrimarySidebarCollapsed: false,
        },
      }),
    )
    await page.setViewportSize({ width: 1440, height: 1000 })
    await openAuthedCanvas(page)
    await expect(page.locator('.workspace-canvas')).toBeVisible()
    await invokeValue(page.request, 'command', 'plugin.install', { directory })
    installed = true
    const opened = await invokeValue<{ nodeId: string }>(
      page.request,
      'command',
      'plugin.window.open',
      {
        pluginId: themePluginId,
        projectId,
        anchor: { x: 760, y: 150 },
      },
    )
    const observer = page
      .locator(`.react-flow__node[data-id="${opened.nodeId}"]`)
      .frameLocator('iframe')
    const context = observer.locator('#context')
    await expect(context).toContainText('"themeId":"pixel"')
    await observer.locator('#draft').fill('Keep my remote view alive')
    await selectPluginTheme(page, selectedTheme, 'Studio')
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-base', 'pixel')

    const note = page.locator('.react-flow__node[data-id="theme-note"]')
    const header = note.locator('[data-cove-part="window-header"]')
    const icon = header.locator('[data-cove-part="icon"]')
    await expect(header).toHaveCSS('height', '44px')
    await expect(header).toHaveCSS('background-image', /linear-gradient.*88, 59, 112/)
    await expect(note.locator('[data-cove-part="window-title"]')).toHaveCSS('font-size', '14px')
    await expect(note.locator('[data-cove-part="window-title"]')).toHaveCSS(
      'font-family',
      '"Courier New", monospace',
    )
    await expect(icon).toHaveCSS('background-image', /url\(["']?data:image\/svg\+xml/)
    await expect(icon.locator(':scope > *').first()).toHaveCSS('visibility', 'hidden')
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.fonts)
            .filter(
              font => font.family.replaceAll('"', '').replaceAll("'", '') === 'Theme Fixture Icons',
            )
            .map(font => font.status),
        ),
      )
      .toEqual(['loaded'])
    await expect(context).toContainText(`"themeId":"${selectedTheme}"`)
    await expect(context).toContainText('"--cove-node-header-height":"44px"')
    await expect(context).toContainText('"family":"Theme Fixture Icons"')
    await expect
      .poll(() =>
        observer.locator('html').evaluate(() =>
          Array.from(document.fonts)
            .filter(
              font => font.family.replaceAll('"', '').replaceAll("'", '') === 'Theme Fixture Icons',
            )
            .map(font => font.status),
        ),
      )
      .toEqual(['loaded'])
    await expect(observer.locator('#draft')).toHaveValue('Keep my remote view alive')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(context).toContainText('"reducedMotion":true')
    await expect(observer.locator('#draft')).toHaveValue('Keep my remote view alive')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(context).toContainText('"reducedMotion":false')
    await expect(observer.locator('#draft')).toHaveValue('Keep my remote view alive')
    await info.attach('web-authored-theme', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })

    await selectTheme(page, 'pixel-light')
    await expect(header).toHaveCSS('height', '34px')
    await expect(icon).toHaveCSS('background-image', 'none')
    await expect(icon.locator(':scope > *').first()).toHaveCSS('visibility', 'visible')
    await expect(page.locator('style[data-cove-theme-stylesheet]')).toHaveCount(0)
    await expect(context).toContainText('"themeId":"pixel-light"')
    await expect(context).toContainText('"fonts":[]')
    await expect(observer.locator('#draft')).toHaveValue('Keep my remote view alive')

    await selectPluginTheme(page, selectedTheme, 'Studio')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', selectedTheme)
    await expect(header).toHaveCSS('height', '44px')
    await page.getByTestId('app-header-control-center').click()
    await expect(page.getByTestId('control-center-current-theme')).toHaveText('Studio')
    await invokeValue(page.request, 'command', 'plugin.setEnabled', {
      pluginId: themePluginId,
      enabled: false,
    })
    // An unavailable plugin theme falls back to the default theme, Cove dark.
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')
    await expect(page.locator('style[data-cove-theme-stylesheet]')).toHaveCount(0)
    await expect(header).toHaveCSS('height', '34px')
    await expect(page.getByTestId('control-center-current-theme')).toHaveCount(0)
    await expect(page.getByTestId('control-center').getByRole('status')).toContainText(
      'unavailable',
    )
    await invokeValue(page.request, 'command', 'plugin.setEnabled', {
      pluginId: themePluginId,
      enabled: true,
    })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', selectedTheme)
    await expect(context).toContainText(`"themeId":"${selectedTheme}"`)
    await expect(page.getByTestId('control-center-current-theme')).toHaveText('Studio')
    await page.getByTestId('control-center-close').click()

    await page.setViewportSize({ width: 390, height: 560 })
    await page.getByTestId('app-header-control-center').tap()
    await expectFits(page.getByTestId('control-center'))
    await page.getByTestId('control-center-theme-family-pixel').check()
    await page.getByTestId('control-center-theme-mode-light').check()
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'pixel-light')
    await info.attach('web-theme-narrow-control-center', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByTestId('control-center-open-settings').tap()
    await expect(page.getByTestId('settings-panel')).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('settings-panel-close').click()
    await openAppearance(page)
    await expectFits(page.getByTestId('settings-panel'))
    await page.getByTestId(`settings-ui-theme-${themeIdentity('light-copy')}`).click()
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-base', 'pixel-light')
    await expect(context).toContainText(`"themeId":"${themeIdentity('light-copy')}"`)
    await info.attach('web-theme-narrow-settings', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.getByTestId('settings-panel-close').click()
    await page.getByTestId('app-header-command-center').tap()
    await expectFits(page.getByTestId('command-center'))
    await page.getByTestId('command-center-close').tap()
    await expect(page.getByTestId('command-center')).toHaveCount(0)
    await expect(page.locator('.workspace-main')).not.toHaveAttribute('inert', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  } finally {
    if (installed) {
      await invokeValue(page.request, 'command', 'plugin.uninstall', { pluginId: themePluginId })
    }
    await rm(directory, { recursive: true, force: true })
    await rm(workspacePath, { recursive: true, force: true })
  }
})
