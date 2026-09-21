import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { createRailAgent } from './sidebar-test-fixtures'
import {
  buildNodeEvalCommand,
  launchApp,
  seedWorkspaceState,
  selectCoveOption,
  testWorkspacePath,
} from './workspace-canvas.helpers'

const PROJECT_ID = 'settings-page-project'
const TERMINAL_ID = 'settings-page-terminal'
const AGENT_ID = 'settings-page-agent'
const SPACE_ID = 'settings-page-space'

async function seedPageWorkspace(
  page: Page,
  focusSettings: { focusNodeOnClick?: boolean; focusNodeTargetZoom?: number } = {},
): Promise<void> {
  await seedWorkspaceState(page, {
    activeWorkspaceId: PROJECT_ID,
    settings: {
      language: 'en',
      uiTheme: 'pixel',
      isPrimarySidebarCollapsed: false,
      terminalDisplayAutoReferenceEnabled: false,
      focusNodeOnClick: false,
      ...focusSettings,
    },
    workspaces: [
      {
        id: PROJECT_ID,
        name: 'Canvas workspace',
        path: testWorkspacePath,
        nodes: [
          {
            id: TERMINAL_ID,
            kind: 'terminal',
            title: 'Keep this session',
            position: { x: 140, y: 180 },
            width: 560,
            height: 340,
          },
          {
            ...createRailAgent(AGENT_ID, 'Review settings', 760, 'Review', '2026-01-01T00:00:00Z'),
            status: 'stopped',
          },
        ],
        spaces: [
          {
            id: SPACE_ID,
            name: 'ui/settings',
            directoryPath: testWorkspacePath,
            nodeIds: [TERMINAL_ID, AGENT_ID],
            rect: { x: 100, y: -40, width: 1100, height: 640 },
          },
        ],
      },
      { id: 'settings-other-project', name: 'Other workspace', path: testWorkspacePath, nodes: [] },
    ],
  })
  await page.locator('.react-flow__controls-fitview').click()
  const agent = page.locator(`[data-id="${AGENT_ID}"]`)
  await agent.getByTestId('node-collapse').click()
  await expect(agent.locator('.cove-node-presentation')).not.toHaveAttribute(
    'data-cove-collapse-motion',
  )
  await expect(page.getByTestId(`collapsed-node-${AGENT_ID}`)).toBeVisible()
}

async function readCanvasRuntime(page: Page) {
  return page.evaluate(terminalId => {
    const terminal = document.querySelector(`[data-id="${terminalId}"] .xterm`)
    const canvas = document.querySelector('.workspace-main')!
    const api = window.__opencoveTerminalSelectionTestApi
    return {
      canvasBounds: canvas.getBoundingClientRect().toJSON(),
      viewport: document.querySelector<HTMLElement>('.react-flow__viewport')?.style.transform,
      terminalBounds: terminal?.getBoundingClientRect().toJSON(),
      registeredNodes: api?.getRegisteredNodeIds().sort(),
      session: api?.getRuntimeSessionId(terminalId),
      instance: api?.getRenderMetrics(terminalId)?.instanceId,
      size: api?.getSize(terminalId),
    }
  }, TERMINAL_ID)
}

async function printMarker(page: Page): Promise<void> {
  const terminal = page.locator(`[data-id="${TERMINAL_ID}"] .terminal-node`)
  await terminal.locator('.xterm').click()
  const stamp = Date.now().toString(36)
  const marker = `SETTINGS_PAGE_${stamp}`
  await page.keyboard.type(
    buildNodeEvalCommand(`console.log(['SETTINGS','PAGE','${stamp}'].join('_'))`),
  )
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText(marker)
}

async function expectPageFillsCanvas(page: Page): Promise<void> {
  const main = await page.locator('.workspace-main').boundingBox()
  const settings = await page.getByTestId('settings-panel').boundingBox()
  expect(main).not.toBeNull()
  expect(settings).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(settings![key] - main![key]), key).toBeLessThanOrEqual(1)
  }
  await Promise.all(
    ['.settings-page', '.settings-panel', '.settings-panel__content'].map(async selector => {
      const overflow = await page.locator(selector).evaluate(element => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }))
      expect(overflow.scroll, selector).toBeLessThanOrEqual(overflow.client + 1)
    }),
  )
}

async function expectCanvasWindowsVisible(page: Page, visible: boolean): Promise<void> {
  const windows = page.locator(
    `[data-id="${TERMINAL_ID}"] .terminal-node, [data-testid="collapsed-node-${AGENT_ID}"]`,
  )
  await expect(windows).toHaveCount(2)
  await expect
    .poll(() =>
      windows.evaluateAll(nodes =>
        nodes.map(node => node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })),
      ),
    )
    .toEqual([visible, visible])
}

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await info.attach(name, { path, contentType: 'image/png' })
}

test.describe('Settings canvas page', () => {
  test('keeps the zoom preview slider above live canvas windows without changing its value', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      // The midpoint lets a real pointer press land on the existing thumb without
      // changing the saved zoom preference, independently of the thumb width.
      await seedPageWorkspace(page, { focusNodeOnClick: true, focusNodeTargetZoom: 1.05 })
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-canvas').click()
      const slider = page.getByTestId('settings-focus-node-target-zoom')
      await expect(slider).toBeEnabled()
      await slider.scrollIntoViewIfNeeded()
      const originalValue = await slider.inputValue()
      const readSavedZoom = () =>
        page.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          return raw ? JSON.parse(raw).settings?.focusNodeTargetZoom : null
        })
      const savedZoom = await readSavedZoom()
      const rect = await slider.boundingBox()
      expect(rect).not.toBeNull()
      await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2)
      await page.mouse.down()
      try {
        await expect(page.getByTestId('settings-panel')).toHaveClass(/settings-page--preview/)
        await expect(page.locator('.workspace-main')).toHaveJSProperty('inert', true)
        await expectCanvasWindowsVisible(page, true)
        await expect(slider).toBeVisible()
        const stacking = await slider.evaluate(element => {
          const settings = element.closest('.settings-page')!
          const canvas = document.querySelector('.workspace-main')!
          const canvasStyle = getComputedStyle(canvas)
          const settingsStyle = getComputedStyle(settings)
          return {
            isolated: canvasStyle.isolation,
            sameParent: canvas.parentElement === settings.parentElement,
            canvasLevel: canvasStyle.zIndex === 'auto' ? 0 : Number(canvasStyle.zIndex),
            settingsLevel: Number(settingsStyle.zIndex),
          }
        })
        expect(stacking.isolated).toBe('isolate')
        expect(stacking.sameParent).toBe(true)
        expect(stacking.settingsLevel).toBeGreaterThan(stacking.canvasLevel)
        await expect(slider).toHaveValue(originalValue)
        await capture(page, testInfo, 'settings-zoom-preview-live-canvas')
      } finally {
        await page.mouse.up()
      }
      await expect(page.getByTestId('settings-panel')).not.toHaveClass(/settings-page--preview/)
      await expectCanvasWindowsVisible(page, false)
      await expect(slider).toHaveValue(originalValue)
      expect(await readSavedZoom()).toBe(savedZoom)
    } finally {
      await electronApp.close()
    }
  })

  test('covers the canvas without remounting or resizing its live terminal', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await seedPageWorkspace(page)
      await printMarker(page)
      const terminalElement = await page
        .locator(`[data-id="${TERMINAL_ID}"] .xterm`)
        .elementHandle()
      const before = await readCanvasRuntime(page)
      expect(before.session).toBeTruthy()
      expect(before.instance).toBeTruthy()
      await expectCanvasWindowsVisible(page, true)
      await page.getByTestId('app-header-settings').click()
      const panel = page.getByTestId('settings-panel')
      await expect(panel).toBeVisible()
      await expect(panel).not.toHaveAttribute('aria-modal')
      await expect(page.getByTestId('settings-panel-search')).toBeFocused()
      await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false)
      await expect(page.locator('.workspace-main')).toHaveJSProperty('inert', true)
      await expect(page.locator('.workspace-main')).toHaveAttribute('aria-hidden', 'true')
      await expectPageFillsCanvas(page)
      await expectCanvasWindowsVisible(page, false)
      expect(await readCanvasRuntime(page)).toEqual(before)
      await page.getByTestId('settings-section-nav-appearance').click()
      await capture(page, testInfo, 'settings-page-pixel')
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await expectCanvasWindowsVisible(page, false)
      await capture(page, testInfo, 'settings-page-pixel-light')
      expect(await terminalElement!.evaluate(element => element.isConnected)).toBe(true)
      expect(await readCanvasRuntime(page)).toEqual(before)

      await page.getByTestId('settings-page-canvas').click()
      await expect(panel).toHaveCount(0)
      await expect(page.locator('.workspace-main')).toHaveJSProperty('inert', false)
      await expect(page.locator('.workspace-main')).not.toHaveAttribute('aria-hidden', 'true')
      await expectCanvasWindowsVisible(page, true)
      await printMarker(page)
      expect(await readCanvasRuntime(page)).toEqual(before)
    } finally {
      await electronApp.close()
    }
  })

  test('keeps sidebar destinations interactive and dismisses nested surfaces before the page', async ({
    browserName: _browserName,
  }) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await seedPageWorkspace(page)
      const panel = page.getByTestId('settings-panel')
      const settings = page.getByTestId('app-header-settings')
      await settings.click()
      const search = page.getByTestId('settings-panel-search')
      await search.fill('theme')
      await search.press('Escape')
      await expect(search).toHaveValue('')
      await expect(panel).toBeVisible()
      await page.getByTestId('settings-language-trigger').click()
      const languageMenu = page.getByTestId('settings-language-menu')
      await expect(languageMenu).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(languageMenu).toHaveCount(0)
      await expect(panel).toBeVisible()
      await page.getByTestId('settings-section-nav-worker').click()
      const registerConnection = page
        .locator(
          '[data-testid="settings-endpoints-open-register"], [data-testid="settings-endpoints-empty-register"]',
        )
        .first()
      await registerConnection.click()
      const connectionDialog = page.getByTestId('settings-endpoints-register-window')
      await expect(connectionDialog).toBeVisible()
      await connectionDialog.locator('input').first().focus()
      await page.keyboard.press('Escape')
      await expect(connectionDialog).toHaveCount(0)
      await expect(panel).toBeVisible()
      await expect(registerConnection).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)

      const navigateFromSettings = async (target: string) => {
        await settings.click()
        await expect(panel).toBeVisible()
        await page.getByTestId(target).click()
        await expect(panel).toHaveCount(0)
        await expect(page.locator('.workspace-main')).toHaveJSProperty('inert', false)
      }
      await navigateFromSettings(`workspace-space-item-${PROJECT_ID}-${SPACE_ID}`)
      await navigateFromSettings(`workspace-agent-item-${PROJECT_ID}-${AGENT_ID}`)
      await navigateFromSettings('workspace-item-settings-other-project')
      await expect(page.getByTestId('workspace-item-settings-other-project')).toHaveAttribute(
        'aria-current',
        'page',
      )
    } finally {
      await electronApp.close()
    }
  })

  test('fills a narrow canvas and opens without focusing a text input', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window: page } = await launchApp()
    try {
      await seedPageWorkspace(page)
      await page.setViewportSize({ width: 390, height: 844 })
      const navigation = page.getByTestId('primary-sidebar-open')
      await navigation.click()
      await page.getByTestId('app-header-settings').click()
      await expect(page.getByTestId('primary-sidebar-drawer')).toHaveCount(0)
      await expect(page.getByTestId('settings-panel-close')).toBeFocused()
      await expectPageFillsCanvas(page)
      await expectCanvasWindowsVisible(page, false)
      await selectCoveOption(page, 'settings-panel-page-selector', 'appearance')
      await capture(page, testInfo, 'settings-page-mobile-pixel')
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.setViewportSize({ width: 320, height: 720 })
      await expectPageFillsCanvas(page)
      await expectCanvasWindowsVisible(page, false)
      await capture(page, testInfo, 'settings-page-mobile-pixel-light')
      await page.getByTestId('settings-panel-close').click()
      await expect(page.getByTestId('settings-panel')).toHaveCount(0)
      await expect(navigation).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })
})
