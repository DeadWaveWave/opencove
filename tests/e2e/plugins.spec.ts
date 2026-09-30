/* eslint-disable no-await-in-loop -- Pointer gestures and persisted state transitions run in sequence. */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import {
  clearAndSeedWorkspace,
  dragMouse,
  launchApp,
  readCanvasViewport,
  readLocatorClientRect,
  removePathWithRetry,
  seededWorkspaceId,
  selectCoveOption,
  testWorkspacePath,
  viewStateStorageKey,
} from './workspace-canvas.helpers'

import { copyPluginFixture, installPlugin } from './plugins.local.helpers'

let source: string
test.beforeEach(async () => {
  source = await copyPluginFixture()
})
test.afterEach(async () => {
  await removePathWithRetry(source)
})

interface SavedPluginNode {
  id: string
  kind: string
  position: { x: number; y: number }
  width: number
  height: number
  task: { pluginId: string; repoPath: string; mountId: string | null; [key: string]: unknown }
}

async function readPluginState(page: Page) {
  return page.evaluate(async projectId => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = JSON.parse(raw ?? '{}') as {
      settings?: { disabledPluginIds?: string[] }
      workspaces?: Array<{
        id: string
        nodes: SavedPluginNode[]
        collapsedNodeIds?: string[]
      }>
    }
    const workspace = state.workspaces?.find(candidate => candidate.id === projectId)
    return {
      node: workspace?.nodes.find(candidate => candidate.kind === 'plugin') ?? null,
      disabled: (
        await window.opencoveApi.controlSurface.invoke<{
          plugins: Array<{ id: string; enabled?: boolean }>
        }>({ kind: 'query', id: 'plugin.list', payload: null })
      ).plugins
        .filter(plugin => plugin.enabled === false)
        .map(plugin => plugin.id),
      collapsed: workspace?.collapsedNodeIds ?? [],
    }
  }, seededWorkspaceId)
}

async function createStandardPlugin(page: Page, withNote = false) {
  await page.setViewportSize({ width: 1800, height: 1200 })
  await clearAndSeedWorkspace(
    page,
    withNote
      ? [
          {
            id: 'plugin-standard-note',
            kind: 'note',
            title: 'Window standard',
            task: { text: 'Shared header dimensions and controls.' },
            position: { x: 60, y: 100 },
            width: 300,
            height: 240,
          },
        ]
      : [],
    {
      settings: {
        uiTheme: 'pixel',
        language: 'en',
        canvasInputMode: 'mouse',
        focusNodeOnClick: false,
        nodeCreationPixelEffectEnabled: false,
        nodeClosePixelEffectEnabled: false,
      },
    },
  )
  await installPlugin(page, source)
  await page.getByTestId('workspace-canvas-action-bar-new-plugin:hello-clock').click()
  const node = page.locator('.workspace-main .react-flow__node-pluginNode')
  await expect(node).toHaveCount(1)
  await expect(node.frameLocator('iframe').locator('#invoke')).toBeEnabled()
  await expect
    .poll(async () => (await readPluginState(page)).node?.task.repoPath)
    .toBe(testWorkspacePath)
  const id = await node.getAttribute('data-id')
  if (!id) {
    throw new Error('Created Hello Clock node has no canvas ID')
  }
  return { node, id }
}

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

async function readHeaderMetrics(header: Locator, titleSelector: string) {
  return header.evaluate((element, selector) => {
    const style = getComputedStyle(element)
    const icon = element.querySelector('.cove-node-kind-icon')!
    const title = element.querySelector(selector)!
    const iconStyle = getComputedStyle(icon)
    const titleStyle = getComputedStyle(title)
    return {
      height: style.height,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      gap: style.gap,
      iconWidth: iconStyle.width,
      iconHeight: iconStyle.height,
      titleFontSize: titleStyle.fontSize,
      titleLineHeight: titleStyle.lineHeight,
    }
  }, titleSelector)
}

async function assertFrameMatches(page: Page, node: Locator, saved: SavedPluginNode) {
  const frame = await readLocatorClientRect(node.locator('.cove-node-presentation'))
  const flow = await readLocatorClientRect(page.locator('.workspace-canvas .react-flow'))
  const viewport = await readCanvasViewport(page)
  expect(frame.width / viewport.zoom).toBeCloseTo(saved.width, 0)
  expect(frame.height / viewport.zoom).toBeCloseTo(saved.height, 0)
  expect((frame.x - flow.x - viewport.x) / viewport.zoom).toBeCloseTo(saved.position.x, 0)
  expect((frame.y - flow.y - viewport.y) / viewport.zoom).toBeCloseTo(saved.position.y, 0)
}

async function openPluginSettings(page: Page) {
  await page.getByTestId('app-header-settings').click()
  await page.getByTestId('settings-section-nav-plugins').click()
  await expect(page.getByTestId('settings-plugin-hello-clock')).toBeVisible()
}

test.describe('Installed plugin window standard', () => {
  test('starts without bundled examples and preserves unavailable plugin windows', async () => {
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(
        page,
        [
          {
            id: 'removed-plugin-window',
            kind: 'plugin',
            title: 'Previous plugin',
            task: {
              pluginId: 'removed-validation-plugin',
              schemaVersion: 1,
              repoPath: testWorkspacePath,
              mountId: null,
              customState: { untouched: true },
            },
            position: { x: 100, y: 120 },
            width: 440,
            height: 300,
          },
        ],
        { settings: { language: 'en', nodeCreationPixelEffectEnabled: false } },
      )
      const list = await page.evaluate(() =>
        window.opencoveApi.controlSurface.invoke<{ plugins: unknown[] }>({
          kind: 'query',
          id: 'plugin.list',
          payload: null,
        }),
      )
      expect(list.plugins).toEqual([])
      const unavailable = page.getByTestId('plugin-node-missing')
      await expect(unavailable).toBeVisible()
      const before = (await readPluginState(page)).node!
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(unavailable).toBeVisible()
      expect((await readPluginState(page)).node).toEqual(before)
      await page.getByTestId('plugin-removed-validation-plugin-close').click()
      await expect.poll(async () => (await readPluginState(page)).node).toBeNull()
    } finally {
      await electronApp.close()
    }
  })

  test('shares window chrome and persists real edge resizing at non-default zoom', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      const { node } = await createStandardPlugin(page, true)
      const noteHeader = page.locator('.note-node__header')
      const pluginHeader = node.locator('.cove-canvas-node-window__header')
      await expect(pluginHeader).toBeVisible()
      expect(await readHeaderMetrics(pluginHeader, '.cove-canvas-node-window__title')).toEqual(
        await readHeaderMetrics(noteHeader, '.note-node__title'),
      )
      const initial = (await readPluginState(page)).node!
      const canvas = await readLocatorClientRect(page.locator('.workspace-canvas .react-flow'))
      // This test covers resize under a transformed canvas, not wheel behavior.
      // Restore a deterministic zoom with enough room around every resize edge.
      await page.evaluate(
        ({ key, projectId, viewport }) => {
          window.localStorage.setItem(
            key,
            JSON.stringify({
              activeWorkspaceId: projectId,
              workspaces: {
                [projectId]: { viewport, isMinimapVisible: false, activeSpaceId: null },
              },
            }),
          )
        },
        {
          key: viewStateStorageKey,
          projectId: seededWorkspaceId,
          viewport: {
            x: canvas.width / 2 - (initial.position.x + initial.width / 2) * 0.7,
            y: canvas.height / 2 - (initial.position.y + initial.height / 2) * 0.7,
            zoom: 0.7,
          },
        },
      )
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(node.frameLocator('iframe').locator('#invoke')).toBeEnabled()
      await expect.poll(async () => (await readCanvasViewport(page)).zoom).toBe(0.7)
      const zoom = (await readCanvasViewport(page)).zoom
      expect(Math.abs(zoom - 1)).toBeGreaterThan(0.1)
      for (const edge of [
        'left',
        'right',
        'top',
        'bottom',
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ]) {
        const handle = node.getByTestId(`plugin-hello-clock-resizer-${edge}`)
        await expect(handle).toBeVisible()
        expect(
          await handle.evaluate(element => {
            const rect = element.getBoundingClientRect()
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            return hit === element || Boolean(hit && element.contains(hit))
          }),
          `${edge} handle receives a real pointer instead of being covered by graph/header content`,
        ).toBe(true)
      }
      for (const gesture of [
        { edge: 'left', dx: -56, dy: 0 },
        { edge: 'top', dx: 0, dy: -42 },
        { edge: 'bottom-right', dx: 70, dy: 56 },
      ]) {
        const before = (await readPluginState(page)).node!
        const rect = await readLocatorClientRect(
          node.getByTestId(`plugin-hello-clock-resizer-${gesture.edge}`),
        )
        const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        await dragMouse(page, {
          start,
          end: { x: start.x + gesture.dx, y: start.y + gesture.dy },
        })
        const expected = {
          x: before.position.x + (gesture.edge === 'left' ? gesture.dx / zoom : 0),
          y: before.position.y + (gesture.edge === 'top' ? gesture.dy / zoom : 0),
          width: before.width + (gesture.edge === 'left' ? -gesture.dx : gesture.dx) / zoom,
          height: before.height + (gesture.edge === 'top' ? -gesture.dy : gesture.dy) / zoom,
        }
        await expect
          .poll(async () => {
            const saved = (await readPluginState(page)).node!
            return Math.max(
              Math.abs(saved.position.x - expected.x),
              Math.abs(saved.position.y - expected.y),
              Math.abs(saved.width - expected.width),
              Math.abs(saved.height - expected.height),
            )
          })
          .toBeLessThan(2)
        await assertFrameMatches(page, node, (await readPluginState(page)).node!)
      }
      const resized = (await readPluginState(page)).node!
      await capture(page, testInfo, 'hello-clock-standard-window-pixel')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(node.frameLocator('iframe').locator('#invoke')).toBeEnabled()
      expect((await readPluginState(page)).node).toEqual(resized)
      await assertFrameMatches(page, node, resized)
      await openPluginSettings(page)
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.locator('.settings-panel__close').click()
      expect(await readHeaderMetrics(pluginHeader, '.cove-canvas-node-window__title')).toEqual(
        await readHeaderMetrics(noteHeader, '.note-node__title'),
      )
      await capture(page, testInfo, 'hello-clock-standard-window-pixel-light')
    } finally {
      await electronApp.close()
    }
  })

  test('keeps the standard collapse, restore and close lifecycle', async () => {
    const { electronApp, window: page } = await launchApp()
    try {
      const { node, id } = await createStandardPlugin(page)
      const original = (await readPluginState(page)).node!
      await node.getByTestId('node-collapse').click()
      const compact = page.getByTestId(`collapsed-node-${id}`)
      await expect(compact).toBeVisible()
      await expect.poll(async () => (await readPluginState(page)).collapsed).toContain(id)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(compact).toBeVisible()
      await compact.getByTestId('node-expand').click()
      await expect(compact).toBeHidden()
      await expect(node.frameLocator('iframe').locator('#invoke')).toBeEnabled()
      await expect(node.locator('.cove-node-presentation')).not.toHaveAttribute(
        'data-cove-collapse-motion',
      )
      const restored = (await readPluginState(page)).node!
      expect(restored.task).toEqual(original.task)
      expect(restored.width).toBe(original.width)
      expect(restored.height).toBe(original.height)
      await node.getByTestId('plugin-hello-clock-close').click()
      await expect(node).toHaveCount(0)
      await expect.poll(async () => (await readPluginState(page)).node).toBeNull()
    } finally {
      await electronApp.close()
    }
  })

  test('manages installed plugins from Settings without destroying existing windows', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      const { id } = await createStandardPlugin(page)
      const node = page.locator(`.react-flow__node[data-id="${id}"]`)
      const original = (await readPluginState(page)).node!
      await openPluginSettings(page)
      const item = page.getByTestId('settings-plugin-hello-clock')
      await expect(item).toContainText('Hello Clock')
      await expect(item).toContainText('0.1.0')
      await expect(page.getByTestId('settings-plugin-enabled-hello-clock')).toBeChecked()
      await capture(page, testInfo, 'plugins-settings-pixel')
      await page.getByTestId('settings-plugin-enabled-hello-clock').click()
      await expect(page.getByTestId('settings-plugin-enabled-hello-clock')).not.toBeChecked()
      await expect.poll(async () => (await readPluginState(page)).disabled).toEqual(['hello-clock'])
      await page.locator('.settings-panel__close').click()
      await expect(node.getByTestId('plugin-node-disabled')).toBeVisible()
      await expect(node.locator('iframe')).toHaveCount(0)
      await expect(
        page.getByTestId('workspace-canvas-action-bar-new-plugin:hello-clock'),
      ).toHaveCount(0)
      await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 16, y: 50 } })
      await expect(page.getByTestId('workspace-context-new-note')).toBeVisible()
      await expect(page.getByTestId('workspace-context-new-plugin-hello-clock')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(node.getByTestId('plugin-node-disabled')).toBeVisible()
      expect((await readPluginState(page)).node).toEqual(original)
      await node.getByTestId('plugin-node-open-settings').click()
      await expect(item).toBeVisible()
      await expect(page.getByTestId('settings-plugin-enabled-hello-clock')).not.toBeChecked()
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.getByTestId('settings-section-nav-plugins').click()
      await capture(page, testInfo, 'plugins-settings-pixel-light')
      await page.getByTestId('settings-plugin-enabled-hello-clock').click()
      await expect(page.getByTestId('settings-plugin-enabled-hello-clock')).toBeChecked()
      await expect.poll(async () => (await readPluginState(page)).disabled).toEqual([])
      await page.locator('.settings-panel__close').click()
      await expect(node.getByTestId('plugin-node-disabled')).toHaveCount(0)
      await expect(node.frameLocator('iframe').locator('#invoke')).toBeEnabled()
      await expect(
        page.getByTestId('workspace-canvas-action-bar-new-plugin:hello-clock'),
      ).toBeVisible()
      expect((await readPluginState(page)).node).toEqual(original)
      await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 16, y: 50 } })
      await expect(page.getByTestId('workspace-context-new-plugin-hello-clock')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('finds plugin settings in Chinese and fits a 320px canvas', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(page, [], {
        settings: { language: 'zh-CN', uiTheme: 'pixel-light' },
      })
      await installPlugin(page, source)
      await page.getByTestId('app-header-settings').click()
      await expect(page.getByTestId('settings-section-nav-plugins')).toHaveText('插件')
      const search = page.getByTestId('settings-panel-search')
      await search.fill('插件')
      await page.getByTestId('settings-panel-search-result-plugins.installed').click()
      await expect(search).toHaveValue('')
      const toggle = page.getByTestId('settings-plugin-enabled-hello-clock')
      await expect(toggle).toHaveAccessibleName('启用 Hello Clock')
      await page.setViewportSize({ width: 320, height: 720 })
      await selectCoveOption(page, 'settings-panel-page-selector', 'general')
      await selectCoveOption(page, 'settings-panel-page-selector', 'plugins')
      await expect(page.getByTestId('settings-plugin-hello-clock')).toBeVisible()
      for (const selector of [
        '.settings-page',
        '.settings-panel__content',
        '.settings-plugin',
        '.settings-plugin-guide',
      ]) {
        const overflow = await page.locator(selector).evaluate(element => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
        }))
        expect(overflow.scroll, selector).toBeLessThanOrEqual(overflow.client + 1)
      }
      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect.poll(async () => (await readPluginState(page)).disabled).toEqual(['hello-clock'])
      await capture(page, testInfo, 'plugins-settings-zh-narrow-pixel-light')
    } finally {
      await electronApp.close()
    }
  })
})
