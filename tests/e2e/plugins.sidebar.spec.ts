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

test('renders a declared Sidebar tree, routes only the clicked backend action, and removes disabled sections', async ({
  browserName: _,
}, info) => {
  test.setTimeout(90_000)
  const source = await mkdtemp(join(tmpdir(), 'opencove-sidebar-extension-'))
  const userDataDir = await createTestUserDataDir()
  const id = 'sidebar-extension-fixture'
  await writeFile(
    join(source, 'opencove.plugin.json'),
    JSON.stringify({
      apiVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Project checks',
      description: 'Sidebar fixture',
      main: 'main.mjs',
      contributes: {
        sidebar: [{ id: 'checks', title: 'Project checks', itemsCommand: 'items' }],
        commands: [
          { id: 'items', title: 'Items', description: 'Read tree', target: 'plugin', menus: [] },
          {
            id: 'check',
            title: 'Run check',
            description: 'Record context',
            target: 'plugin',
            menus: ['sidebar'],
          },
          {
            id: 'inspect',
            title: 'Inspect',
            description: 'Read last context',
            target: 'plugin',
            menus: [],
          },
        ],
      },
    }),
  )
  await writeFile(
    join(source, 'main.mjs'),
    `export function activate() { let last = null; let reads = 0; return { runCommand(id, params, context) {
    if (id === 'items') { reads++; return { items: [{ id:'group', label:'Workspace', children:[{id:'check',label:'Run selected check',description:'Ready',command:{id:'check',params:{check:'selected'}}}]}] }; }
    if (id === 'check') { last = { params, context }; return {ok:true}; }
    return {last,reads};
  } }; }`,
  )
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await page.setViewportSize({ width: 1280, height: 850 })
    await clearAndSeedWorkspace(page, [], { settings: { language: 'en', uiTheme: 'pixel' } })
    await pluginCli(userDataDir, ['install', source])
    const section = page.getByTestId(`plugin-sidebar-${id}-checks`)
    await expect(section).toBeVisible()
    expect(await pluginCli(userDataDir, ['run', id, 'inspect'])).toEqual({ last: null, reads: 0 })
    await section.getByRole('button', { name: 'Project checks' }).click()
    await section.getByRole('button', { name: 'Workspace', exact: true }).click()
    await section.getByRole('button', { name: 'Run selected check' }).click()
    await expect
      .poll(() => pluginCli(userDataDir, ['run', id, 'inspect']))
      .toMatchObject({
        last: {
          params: { check: 'selected' },
          context: { host: { surface: 'sidebar', projectId: seededWorkspaceId } },
        },
        reads: 1,
      })
    expect(await savedCommandNodes(page, id)).toEqual([])
    await capturePlugins(page, info, 'plugin-sidebar-dark')
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId(`settings-plugin-details-${id}`).click()
    const sidebarToggle = page.getByTestId(`settings-plugin-contribution-sidebar-${id}`)
    await expect(sidebarToggle).toBeChecked()
    await page.getByTestId(`settings-plugin-contribution-tile-sidebar-${id}`).click()
    await expect(sidebarToggle).not.toBeChecked()
    await expect
      .poll(async () =>
        page.evaluate(async pluginId => {
          const state = JSON.parse(
            (await window.opencoveApi.persistence.readWorkspaceStateRaw()) ?? '{}',
          )
          return state.settings?.pluginContributions?.[pluginId]?.sidebar
        }, id),
      )
      .toBe(false)
    await page.locator('.settings-panel__close').click()
    await expect(section).toHaveCount(0)
    // Entry visibility does not disable the plugin or its declared backend commands.
    expect(await pluginCli(userDataDir, ['run', id, 'inspect'])).toMatchObject({ reads: 1 })
    await page.reload()
    await expect(page.getByTestId('app-header-settings')).toBeVisible()
    await expect(section).toHaveCount(0)
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId(`settings-plugin-details-${id}`).click()
    await expect(sidebarToggle).not.toBeChecked()
    await sidebarToggle.click()
    await expect(sidebarToggle).toBeChecked()
    await page.locator('.settings-panel__close').click()
    await expect(section).toBeVisible()
    await section.getByRole('button', { name: 'Project checks' }).click()
    await section.getByRole('button', { name: 'Workspace', exact: true }).click()
    await page.getByTestId('app-header-settings').click()
    await page.getByTestId('settings-section-nav-appearance').click()
    await page.getByTestId('settings-ui-theme-pixel-light').click()
    await page.locator('.settings-panel__close').click()
    await capturePlugins(page, info, 'plugin-sidebar-light')
    await page.setViewportSize({ width: 390, height: 780 })
    await page.getByTestId('primary-sidebar-open').click()
    await expect(section).toBeVisible()
    await expect(page.getByTestId('primary-sidebar-drawer')).toHaveCSS('opacity', '1')
    await section.getByRole('button', { name: 'Project checks' }).click()
    await section.getByRole('button', { name: 'Workspace', exact: true }).click()
    await expect(section.getByRole('button', { name: 'Run selected check' })).toBeVisible()
    await capturePlugins(page, info, 'plugin-sidebar-mobile')
    await pluginCommand(page, 'plugin.setEnabled', { pluginId: id, enabled: false })
    await expect(section).toHaveCount(0)
    await pluginCommand(page, 'plugin.setEnabled', { pluginId: id, enabled: true })
    await expect(section).toBeVisible()
    await expect(section.getByRole('button', { name: 'Project checks' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  } finally {
    await electronApp.close()
    await removePathWithRetry(source)
    await removePathWithRetry(userDataDir)
  }
})
