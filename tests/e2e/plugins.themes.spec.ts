/* eslint-disable no-await-in-loop -- Theme changes and disclosure endpoints are ordered transactions. */
import { expect, test } from '@playwright/test'
import {
  createTestUserDataDir,
  dragMouse,
  launchApp,
  readLocatorClientRect,
  removePathWithRetry,
  seededWorkspaceId,
} from './workspace-canvas.helpers'
import { pluginCli } from './plugins.commands.helpers'
import { capturePlugins, pluginCommand } from './plugins.local.helpers'
import { generateFamilyTheme, generateTheme } from '../../src/shared/design/themeGenerator'
import { themeTokens } from '../../src/shared/design/themeTokens'
import {
  chooseTheme,
  createPaletteThemePlugin,
  createThemePlugin,
  layoutSize,
  paletteThemeIdentity,
  paletteThemeInput,
  readThemePaint,
  seedThemeWorkspace,
  themeCompactId,
  themeIdentity,
  themeNoteId,
  themePluginId,
  themeSpaceId,
} from './plugins.themes.helpers'
import {
  expectIdentityEndpointContinuous,
  finishCollapseAnimations,
  pauseCollapseAnimations,
  readIdentityFrame,
  seekCollapseEndpoint,
} from './workspace-canvas.collapse-motion-endpoints.helpers'

test('independent theme plugins reproduce both Cove bases and recover persisted selection', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000)
  const directory = await createThemePlugin()
  const userDataDir = await createTestUserDataDir()
  let { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await seedThemeWorkspace(page)
    await pluginCli(userDataDir, ['install', directory])
    for (const [base, copy] of [
      ['dark', 'dark-copy'],
      ['light', 'light-copy'],
    ]) {
      await chooseTheme(page, base!)
      const header = page.locator(
        `.react-flow__node[data-id="${themeNoteId}"] [data-cove-part="window-header"]`,
      )
      // The base's kind wash: Cove paints it over the header, in its ::after.
      const kindWash = () =>
        header.evaluate(element => getComputedStyle(element, '::after').backgroundImage)
      await expect.poll(kindWash).toContain('linear-gradient')
      const inherited = await readThemePaint(page)
      await chooseTheme(page, themeIdentity(copy!))
      await expect(page.locator('html')).toHaveAttribute('data-cove-theme-base', base!)
      await expect.poll(() => readThemePaint(page)).toEqual(inherited)
      await expect.poll(kindWash).toContain('linear-gradient')
      await capturePlugins(page, info, `independent-${copy}`)
    }
    const selectedId = themeIdentity('light-copy')
    await electronApp.close()
    ;({ electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false }))
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', selectedId)
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-base', 'light')
    await pluginCommand(page, 'plugin.setEnabled', { pluginId: themePluginId, enabled: false })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')
    await pluginCommand(page, 'plugin.setEnabled', { pluginId: themePluginId, enabled: true })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', selectedId)
    await pluginCommand(page, 'plugin.uninstall', { pluginId: themePluginId })
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'dark')
    await expect(page.locator('style[data-cove-theme-stylesheet]')).toHaveCount(0)
    await pluginCli(userDataDir, ['install', directory])
    await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', selectedId)
  } finally {
    await electronApp.close()
    await removePathWithRetry(directory)
    await removePathWithRetry(userDataDir)
  }
})

test('a palette theme is generated from its four inputs on the Cove foundation', async () => {
  const directory = await createPaletteThemePlugin()
  const userDataDir = await createTestUserDataDir()
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  const readToken = (name: string) =>
    page.evaluate(
      token => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
      name,
    )
  try {
    await seedThemeWorkspace(page)
    await pluginCli(userDataDir, ['install', directory])
    await chooseTheme(page, paletteThemeIdentity)
    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-cove-theme-base', 'dark')
    await expect(root).toHaveAttribute('data-cove-family', 'cove')
    const expected = themeTokens(generateTheme(paletteThemeInput))
    const cove = themeTokens(generateFamilyTheme('cove', 'dark'))
    for (const token of [
      '--cove-accent',
      '--cove-neutral-1',
      '--cove-text',
      '--cove-window-surface',
    ]) {
      expect(await readToken(token), token).toBe(expected[token])
    }
    expect(expected['--cove-accent']).not.toBe(cove['--cove-accent'])

    await chooseTheme(page, 'dark')
    await expect(page.locator('style[data-cove-theme-palette]')).toHaveCount(0)
    expect(await readToken('--cove-accent')).toBe(cove['--cove-accent'])
  } finally {
    await electronApp.close()
    await removePathWithRetry(directory)
    await removePathWithRetry(userDataDir)
  }
})

test('author CSS, assets and metrics follow real window geometry and the live iframe theme context', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000)
  const directory = await createThemePlugin()
  const userDataDir = await createTestUserDataDir()
  const { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await seedThemeWorkspace(page)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await pluginCli(userDataDir, ['install', directory])
    const opened = await pluginCli<{ nodeId: string }>(userDataDir, [
      'open',
      themePluginId,
      '--project',
      seededWorkspaceId,
    ])
    const observer = page
      .locator(`.react-flow__node[data-id="${opened.nodeId}"]`)
      .frameLocator('iframe')
    const context = observer.locator('#context')
    await expect(context).toContainText('"themeId":"dark"')
    await observer.locator('#draft').fill('Preserve this view across theme changes')
    await chooseTheme(page, themeIdentity('studio'))
    await expect(context).toContainText(`"themeId":"${themeIdentity('studio')}"`)
    await expect(context).toContainText('"baseThemeId":"dark"')
    await expect(context).toContainText('"themeVersion":1')
    await expect(context).toContainText('"--cove-node-header-height":"44px"')
    await expect(observer.locator('html')).toHaveAttribute(
      'data-cove-theme-id',
      themeIdentity('studio'),
    )
    await expect(observer.locator('#draft')).toHaveValue('Preserve this view across theme changes')

    const note = page.locator(`.react-flow__node[data-id="${themeNoteId}"]`)
    const header = note.locator('[data-cove-part="window-header"]')
    await expect.poll(() => layoutSize(header)).toMatchObject({ height: 44 })
    await expect(header).toHaveCSS(
      'background-image',
      'linear-gradient(90deg, rgb(88, 59, 112), rgb(32, 61, 84))',
    )
    await expect(note.locator('[data-cove-part="window-title"]')).toHaveCSS('font-size', '14px')
    await expect(note.locator('[data-cove-part="window-title"]')).toHaveCSS(
      'font-family',
      '"Courier New", monospace',
    )
    await expect(note.locator('[data-cove-part="window-title"]')).toHaveCSS(
      'color',
      'rgb(255, 233, 196)',
    )
    const noteIcon = header.locator('[data-cove-part="icon"]')
    await expect(noteIcon).toHaveCSS('width', '20px')
    await expect(noteIcon).toHaveCSS('background-image', /url\("data:image\/svg\+xml/)
    await expect(noteIcon.locator(':scope > *').first()).toHaveCSS('visibility', 'hidden')
    const compact = page.getByTestId(`collapsed-node-${themeCompactId}`)
    await expect(compact.locator('[data-cove-part="icon"]')).toHaveCSS('width', '30px')
    expect(await layoutSize(compact)).toEqual({ width: 112, height: 96 })
    await expect(page.locator('[data-cove-part="sidebar"]')).toHaveCSS(
      'background-color',
      'rgb(23, 35, 42)',
    )
    await expect
      .poll(() =>
        page
          .getByTestId(`workspace-space-region-${themeSpaceId}`)
          .evaluate(element => getComputedStyle(element, '::after').borderTopColor),
      )
      .toBe('rgb(255, 169, 119)')

    const beforeResize = await layoutSize(note)
    const handle = await readLocatorClientRect(note.getByTestId('note-resizer-bottom-right'))
    await dragMouse(page, {
      start: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      end: { x: handle.x + handle.width / 2 + 45, y: handle.y + handle.height / 2 + 35 },
    })
    await expect
      .poll(async () => (await layoutSize(note)).width)
      .toBeGreaterThan(beforeResize.width + 10)
    const expandedSize = await layoutSize(note)
    for (const direction of ['collapse', 'expand'] as const) {
      await pauseCollapseAnimations(page, themeNoteId)
      await note.getByTestId(direction === 'collapse' ? 'node-collapse' : 'node-expand').click()
      await seekCollapseEndpoint(page)
      const lastAnimated = await readIdentityFrame(page, themeNoteId, 'compact')
      await finishCollapseAnimations(page, themeNoteId)
      const settled = await readIdentityFrame(
        page,
        themeNoteId,
        direction === 'collapse' ? 'compact' : 'header',
      )
      expectIdentityEndpointContinuous(lastAnimated, settled)
    }
    expect(await layoutSize(note)).toEqual(expandedSize)
    await expect.poll(() => layoutSize(header)).toMatchObject({ height: 44 })
    await capturePlugins(page, info, 'independent-theme-custom-materials')
    await chooseTheme(page, 'light')
    await expect(page.locator('style[data-cove-theme-stylesheet]')).toHaveCount(0)
    await expect.poll(() => layoutSize(header)).toMatchObject({ height: 34 })
    await expect(noteIcon).toHaveCSS('background-image', 'none')
    await expect(noteIcon.locator(':scope > *').first()).toHaveCSS('visibility', 'visible')
    await expect(context).toContainText('"themeId":"light"')
    await expect(context).toContainText('"--cove-node-header-height":"34px"')
    await expect(observer.locator('#draft')).toHaveValue('Preserve this view across theme changes')
  } finally {
    await electronApp.close()
    await removePathWithRetry(directory)
    await removePathWithRetry(userDataDir)
  }
})
