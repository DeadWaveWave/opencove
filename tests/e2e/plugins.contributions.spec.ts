import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
  selectCoveOption,
} from './workspace-canvas.helpers'

type Contributions = { actionBar?: boolean; contextMenu?: boolean }
type PluginRecord = { id: string; kind: string; task: unknown }

async function readPluginPreferences(page: Page) {
  return page.evaluate(async id => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      settings?: {
        disabledPluginIds?: string[]
        pluginContributions?: Record<string, Contributions>
      }
      workspaces?: Array<{ id: string; nodes: PluginRecord[] }>
    }
    return {
      disabled: state.settings?.disabledPluginIds ?? [],
      contributions: state.settings?.pluginContributions?.['git-board'] ?? {},
      nodes: (state.workspaces?.find(workspace => workspace.id === id)?.nodes ?? [])
        .filter(node => node.kind === 'plugin')
        .map(node => ({ id: node.id, task: node.task })),
    }
  }, seededWorkspaceId)
}

async function openDetails(page: Page) {
  await page.getByTestId('app-header-settings').click()
  await page.getByTestId('settings-section-nav-plugins').click()
  await page.getByTestId('settings-plugin-details-git-board').click()
  await expect(page.getByTestId('settings-plugin-detail-git-board')).toBeVisible()
}

async function openCanvasMenu(page: Page) {
  const point = await page
    .locator('.workspace-main .workspace-canvas .react-flow')
    .evaluate(flow => {
      const bounds = flow.getBoundingClientRect()
      for (const [left, top] of [
        [0.08, 0.1],
        [0.85, 0.12],
        [0.08, 0.7],
        [0.8, 0.75],
        [0.4, 0.92],
      ]) {
        const x = bounds.x + bounds.width * left
        const y = bounds.y + bounds.height * top
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) {
          return { x, y }
        }
      }
      throw new Error('No unoccupied canvas point is available for a creation menu')
    })
  await page.mouse.click(point.x, point.y, { button: 'right' })
  await expect(page.getByTestId('workspace-context-new-note')).toBeVisible()
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

test('keeps creation shortcut preferences independent across plugin disablement and a full restart', async ({
  browserName: _browserName,
}, testInfo) => {
  const userDataDir = await createTestUserDataDir()
  let { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
  try {
    await page.setViewportSize({ width: 1500, height: 1050 })
    await clearAndSeedWorkspace(page, [], {
      settings: {
        uiTheme: 'pixel',
        language: 'en',
        focusNodeOnClick: false,
        nodeCreationPixelEffectEnabled: false,
        nodeClosePixelEffectEnabled: false,
      },
    })
    const actionBar = () => page.getByTestId('workspace-canvas-action-bar-new-git-board')
    const contextMenu = () => page.getByTestId('workspace-context-new-git-board')
    const actionToggle = () => page.getByTestId('settings-plugin-contribution-actionBar-git-board')
    const contextToggle = () =>
      page.getByTestId('settings-plugin-contribution-contextMenu-git-board')
    const actionTile = () =>
      page.getByTestId('settings-plugin-contribution-tile-actionBar-git-board')
    const contextTile = () =>
      page.getByTestId('settings-plugin-contribution-tile-contextMenu-git-board')
    const actualNodes = () => page.locator('.workspace-main .react-flow__node:has(.git-board-node)')

    await actionBar().click()
    await expect(actualNodes()).toHaveCount(1)
    await expect(actualNodes().first().locator('.git-board-node__commit').first()).toBeVisible()
    await expect.poll(async () => (await readPluginPreferences(page)).nodes.length).toBe(1)
    const original = (await readPluginPreferences(page)).nodes[0]

    await openDetails(page)
    await expect(actionToggle()).toBeChecked()
    await expect(contextToggle()).toBeChecked()
    // Click the visible label text, not the input or its small visual thumb.
    await actionTile().getByText('Action bar', { exact: true }).click()
    await expect(actionToggle()).not.toBeChecked()
    await expect(contextToggle()).toBeChecked()
    await expect
      .poll(async () => (await readPluginPreferences(page)).contributions)
      .toEqual({ actionBar: false })
    await capture(page, testInfo, 'plugin-creation-shortcuts-pixel')
    await page.locator('.settings-panel__close').click()
    await expect(actionBar()).toHaveCount(0)
    await expect(actualNodes()).toHaveCount(1)
    expect((await readPluginPreferences(page)).nodes).toContainEqual(original)
    await openCanvasMenu(page)
    await expect(contextMenu()).toBeVisible()
    await contextMenu().click()
    await expect(actualNodes()).toHaveCount(2)
    await expect.poll(async () => (await readPluginPreferences(page)).nodes.length).toBe(2)

    await openDetails(page)
    // The padded block area is also a native label target.
    await actionTile().click({ position: { x: 9, y: 9 } })
    await expect(actionToggle()).toBeChecked()
    await contextTile().getByText('Right-click menu', { exact: true }).click()
    await expect(contextToggle()).not.toBeChecked()
    await expect
      .poll(async () => (await readPluginPreferences(page)).contributions)
      .toEqual({
        actionBar: true,
        contextMenu: false,
      })
    await page.locator('.settings-panel__close').click()
    await openCanvasMenu(page)
    await expect(contextMenu()).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(actionBar()).toBeVisible()
    await actionBar().click()
    await expect(actualNodes()).toHaveCount(3)
    await expect.poll(async () => (await readPluginPreferences(page)).nodes.length).toBe(3)
    const savedNodes = (await readPluginPreferences(page)).nodes
    expect(savedNodes).toContainEqual(original)

    await openDetails(page)
    await page.getByTestId('settings-plugin-enabled-git-board').uncheck()
    await expect(actionToggle()).toBeChecked()
    await expect(actionToggle()).toBeEnabled()
    await expect(contextToggle()).not.toBeChecked()
    await expect(contextToggle()).toBeEnabled()
    await expect
      .poll(async () => (await readPluginPreferences(page)).disabled)
      .toEqual(['git-board'])
    await page.locator('.settings-panel__close').click()
    await expect(page.getByTestId('plugin-node-disabled')).toHaveCount(3)
    await expect(actionBar()).toHaveCount(0)
    await openCanvasMenu(page)
    await expect(contextMenu()).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect((await readPluginPreferences(page)).nodes).toEqual(savedNodes)
    await electronApp.close()
    ;({ electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false }))
    await page.setViewportSize({ width: 1500, height: 1050 })
    await expect(page.getByTestId('plugin-node-disabled')).toHaveCount(3)
    await expect(actionBar()).toHaveCount(0)
    expect(await readPluginPreferences(page)).toEqual({
      disabled: ['git-board'],
      contributions: { actionBar: true, contextMenu: false },
      nodes: savedNodes,
    })
    await openDetails(page)
    await expect(page.getByTestId('settings-plugin-enabled-git-board')).not.toBeChecked()
    await expect(actionToggle()).toBeChecked()
    await expect(contextToggle()).not.toBeChecked()
    await page.getByTestId('settings-section-nav-appearance').click()
    await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
    await page.getByTestId('settings-section-nav-plugins').click()
    await page.getByTestId('settings-plugin-details-git-board').click()
    await capture(page, testInfo, 'plugin-creation-shortcuts-pixel-light')
    await page.getByTestId('settings-plugin-enabled-git-board').check()
    await expect.poll(async () => (await readPluginPreferences(page)).disabled).toEqual([])
    await page.locator('.settings-panel__close').click()
    await expect(page.getByTestId('plugin-node-disabled')).toHaveCount(0)
    await expect(actualNodes()).toHaveCount(3)
    await expect(actualNodes().first().locator('.git-board-node__commit').first()).toBeVisible()
    await expect(actionBar()).toBeVisible()
    await openCanvasMenu(page)
    await expect(contextMenu()).toHaveCount(0)
    expect(await readPluginPreferences(page)).toEqual({
      disabled: [],
      contributions: { actionBar: true, contextMenu: false },
      nodes: savedNodes,
    })
  } finally {
    await electronApp.close()
    await removePathWithRetry(userDataDir)
  }
})
