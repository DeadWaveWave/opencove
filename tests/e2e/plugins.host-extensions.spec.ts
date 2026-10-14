import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { pluginCli, savedCommandNodes } from './plugins.commands.helpers'
import { capturePlugins, pluginCommand } from './plugins.local.helpers'

test('uses host commands, preferences and themes without creating windows, and restores user choices', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-host-extension-'))
  const userDataDir = await createTestUserDataDir()
  const pluginId = 'host-extension-fixture'
  const themeId = `plugin:${pluginId}:dusk`
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id: pluginId,
      version: '1.0.0',
      displayName: 'Host extension fixture',
      description: 'Independent host extension fixture',
      main: 'main.mjs',
      contributes: {
        commands: [
          {
            id: 'record',
            title: 'Record context',
            description: 'Record the invocation context',
            target: 'plugin',
            menus: ['commandCenter', 'canvas', 'node', 'space'],
          },
          {
            id: 'inspect',
            title: 'Inspect result',
            description: 'Read the last recorded context',
            target: 'plugin',
            menus: [],
          },
        ],
        preferences: [
          {
            id: 'label',
            title: 'Label',
            description: 'The label used by commands.',
            type: 'string',
            default: 'Initial label',
          },
          { id: 'compact', title: 'Compact', type: 'boolean', default: false },
        ],
        themes: [
          {
            id: 'dusk',
            title: 'Dusk fixture',
            appearance: 'dark',
            tokens: {
              '--cove-accent': '#90bfff',
              '--cove-app-background': '#101823',
              '--cove-text': '#f0f4fa',
            },
          },
          {
            id: 'dawn',
            title: 'Dawn fixture',
            appearance: 'light',
            tokens: {
              '--cove-accent': '#315a87',
              '--cove-app-background': '#f3f5fa',
              '--cove-text': '#152336',
            },
          },
        ],
      },
    }),
  )
  await writeFile(
    join(source, 'main.mjs'),
    `export function activate() { let last; return { runCommand(id, _params, context) { if (id === 'record') last = context; return last ?? null; } }; }`,
  )
  let { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await page.setViewportSize({ width: 1400, height: 1000 })
    await clearAndSeedWorkspace(page, [], {
      settings: { language: 'en', uiTheme: 'pixel', canvasInputMode: 'mouse' },
    })
    await pluginCli(userDataDir, ['install', source])
    await page.getByTestId('app-header-command-center').click()
    await page.getByTestId(`command-center-item-${pluginId}:record`).click()
    await expect
      .poll(() => pluginCli(userDataDir, ['run', pluginId, 'inspect']))
      .toMatchObject({
        host: { surface: 'commandCenter', projectId: seededWorkspaceId },
        preferences: { label: 'Initial label', compact: false },
      })
    expect(await savedCommandNodes(page, pluginId)).toEqual([])

    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId(`settings-plugin-details-${pluginId}`).click()
    const preference = page.getByTestId(`plugin-preference-${pluginId}-label`)
    await expect(preference).toHaveValue('Initial label')
    await preference.fill('Restored label')
    await preference.press('Enter')
    await expect(preference).toBeEnabled()
    await page.getByTestId(`plugin-preference-${pluginId}-compact`).click()
    await expect(page.getByTestId(`plugin-preference-${pluginId}-compact`)).toBeChecked()
    await page.getByTestId('settings-section-nav-appearance').click()
    await page.getByTestId(`settings-ui-theme-plugin:${pluginId}:dawn`).click()
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme', 'light')
    await capturePlugins(page, info, 'host-extension-light')
    await page.getByTestId(`settings-ui-theme-${themeId}`).click()
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', themeId)
    await capturePlugins(page, info, 'host-extension-dark')
    await page.locator('.settings-panel__close').click()

    await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 600, y: 400 } })
    await page.getByTestId(`plugin-menu-command-${pluginId}:record`).click()
    await expect
      .poll(() => pluginCli(userDataDir, ['run', pluginId, 'inspect']))
      .toMatchObject({
        host: { surface: 'canvas', projectId: seededWorkspaceId },
        preferences: { label: 'Restored label', compact: true },
      })
    await electronApp.close()
    ;({ electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false }))
    await page.setViewportSize({ width: 1400, height: 1000 })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', themeId)
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId(`settings-plugin-details-${pluginId}`).click()
    await expect(page.getByTestId(`plugin-preference-${pluginId}-label`)).toHaveValue(
      'Restored label',
    )
    await expect(page.getByTestId(`plugin-preference-${pluginId}-compact`)).toBeChecked()
    await pluginCommand(page, 'plugin.setEnabled', { pluginId, enabled: false })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')
    await pluginCommand(page, 'plugin.setEnabled', { pluginId, enabled: true })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', themeId)
    await pluginCommand(page, 'plugin.uninstall', { pluginId })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')
    expect(await savedCommandNodes(page, pluginId)).toEqual([])
  } finally {
    await electronApp.close()
    await removePathWithRetry(source)
    await removePathWithRetry(userDataDir)
  }
})

test('dispatches a window menu command only to the explicitly chosen live view', async () => {
  test.setTimeout(90_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-menu-window-'))
  const userDataDir = await createTestUserDataDir()
  const pluginId = 'menu-window-fixture'
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id: pluginId,
      version: '1.0.0',
      displayName: 'Menu window fixture',
      description: 'Explicit view fixture',
      view: { entry: 'index.html', instances: 'multiple' },
      contributes: {
        commands: [
          {
            id: 'advance',
            title: 'Advance counter',
            description: 'Advance only this view',
            target: 'window',
            menus: ['commandCenter', 'node', 'space', 'canvas'],
          },
        ],
      },
    }),
  )
  await writeFile(
    join(source, 'index.html'),
    '<html><head><script src="view.js" defer></script></head><body><output id="count">0</output><output id="surface"></output></body></html>',
  )
  await writeFile(
    join(source, 'view.js'),
    `window.opencovePlugin.ready.then(() => { let count = 0; window.opencovePlugin.onCommand((_id, _params, context) => { document.querySelector('#count').textContent = String(++count); document.querySelector('#surface').textContent = context?.surface ?? 'missing'; return count; }); });`,
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en', uiTheme: 'pixel' } })
    await pluginCli(userDataDir, ['install', source])
    await page.getByTestId('app-header-command-center').click()
    await expect(
      page.locator(`[data-testid^="command-center-item-${pluginId}:advance:"]`),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await savedCommandNodes(page, pluginId)).toEqual([])
    const first = await pluginCli<{ nodeId: string }>(userDataDir, [
      'open',
      pluginId,
      '--project',
      seededWorkspaceId,
    ])
    const second = await pluginCli<{ nodeId: string }>(userDataDir, [
      'open',
      pluginId,
      '--project',
      seededWorkspaceId,
    ])
    await expect
      .poll(async () => {
        const result = await pluginCli<{
          windows: Array<{ nodeId: string; views: Array<{ viewId: string; ready: boolean }> }>
        }>(userDataDir, ['windows', pluginId])
        return result.windows.flatMap(item => item.views.filter(view => view.ready)).length
      })
      .toBe(2)
    await page.getByTestId('app-header-command-center').click()
    const commands = page.locator(`[data-testid^="command-center-item-${pluginId}:advance:"]`)
    await expect(commands).toHaveCount(2)
    await commands.first().click()
    const firstCount = page
      .locator(`.workspace-main .react-flow__node[data-id="${first.nodeId}"]`)
      .frameLocator('iframe')
      .locator('#count')
    const secondCount = page
      .locator(`.workspace-main .react-flow__node[data-id="${second.nodeId}"]`)
      .frameLocator('iframe')
      .locator('#count')
    await expect
      .poll(
        async () =>
          Number(await firstCount.textContent()) + Number(await secondCount.textContent()),
      )
      .toBe(1)
    const result = await pluginCli<{
      windows: Array<{ nodeId: string; views: Array<{ viewId: string; ready: boolean }> }>
    }>(userDataDir, ['windows', pluginId])
    const chosen = result.windows
      .find(item => item.nodeId === first.nodeId)!
      .views.find(view => view.ready)!
    await page.getByTestId('app-header-command-center').click()
    await page.getByTestId(`command-center-item-${pluginId}:advance:${chosen.viewId}`).click()
    await expect(
      page
        .locator(`.workspace-main .react-flow__node[data-id="${first.nodeId}"]`)
        .frameLocator('iframe')
        .locator('#surface'),
    ).toHaveText('commandCenter')
    expect((await savedCommandNodes(page, pluginId)).length).toBe(2)
  } finally {
    await electronApp.close()
    await removePathWithRetry(source)
    await removePathWithRetry(userDataDir)
  }
})
