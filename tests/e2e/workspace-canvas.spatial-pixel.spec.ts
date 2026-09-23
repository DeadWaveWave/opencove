import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { readFieldSignature, readStableFieldBaseline } from './workspace-canvas.pixel-field.helpers'
import {
  PIXEL_EFFECTS_DISABLED,
  PIXEL_EFFECTS_ENABLED,
  readPixelEffects,
  setPixelEffects,
} from './workspace-canvas.pixel-effects.helpers'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  selectCoveOption,
} from './workspace-canvas.helpers'

const NODE_ID = 'spatial-pixel-terminal'
const findModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function terminalNode(window: Page) {
  return window.locator(`.react-flow__node[data-id="${NODE_ID}"] .terminal-node`)
}

async function seedTerminal(window: Page, uiTheme: 'dark' | 'pixel', language = 'en') {
  await clearAndSeedWorkspace(
    window,
    [
      {
        id: NODE_ID,
        title: 'Pixel terminal',
        position: { x: 160, y: 140 },
        width: 580,
        height: 360,
      },
      {
        id: 'spatial-pixel-note',
        title: 'Workspace notes',
        kind: 'note',
        position: { x: 800, y: 180 },
        width: 340,
        height: 260,
        task: { text: 'A quiet canvas. Live sessions keep their own state.' },
      },
    ],
    {
      settings: {
        uiTheme,
        language,
        ...(uiTheme === 'pixel' ? PIXEL_EFFECTS_ENABLED : PIXEL_EFFECTS_DISABLED),
      },
    },
  )
  await expect(terminalNode(window).locator('.terminal-node__terminal .xterm')).toBeVisible()
}

async function openAppearance(window: Page) {
  await window.getByTestId('app-header-settings').click({ noWaitAfter: true })
  await window.getByTestId('settings-section-nav-appearance').click()
}

async function expectTheme(window: Page, themeId: 'pixel' | 'dark' | 'light') {
  await expect(window.locator('html')).toHaveAttribute('data-cove-theme-id', themeId)
  await expect(window.locator('html')).toHaveAttribute(
    'data-cove-theme',
    themeId === 'light' ? 'light' : 'dark',
  )
}

async function readPersistedTheme(window: Page): Promise<string | null> {
  return await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    if (!raw) {
      return null
    }
    const state = JSON.parse(raw) as { settings?: { uiTheme?: string } }
    return state.settings?.uiTheme ?? null
  })
}

async function attachScreenshot(window: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await window.screenshot({ path: screenshotPath, animations: 'disabled' })
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: 'image/png',
  })
}

async function readTerminalContinuity(window: Page) {
  return await window.evaluate(async nodeId => {
    const api = window.__opencoveTerminalSelectionTestApi
    const size = api?.getSize(nodeId)
    const instanceId = api?.getRenderMetrics(nodeId)?.instanceId
    const sessionId = api?.getRuntimeSessionId(nodeId)
    const body = document.querySelector(
      `.react-flow__node[data-id="${nodeId}"] .terminal-node__terminal`,
    )
    if (!size || !instanceId || !sessionId || !(body instanceof HTMLElement)) {
      return null
    }
    const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId })
    return {
      sessionId,
      instanceId,
      renderer: size,
      worker: { cols: snapshot.cols, rows: snapshot.rows },
      body: { width: body.clientWidth, height: body.clientHeight },
    }
  }, NODE_ID)
}

async function printThroughTerminal(window: Page, phase: string) {
  const suffix = Date.now().toString(36)
  const prefix = `PIXEL_${phase}`
  const expectedOutput = `${prefix}_${suffix}`
  const command =
    process.platform === 'win32'
      ? buildNodeEvalCommand(`process.stdout.write(${JSON.stringify(`${expectedOutput}\n`)})`)
      : `printf '%s_%s\\n' '${prefix}' '${suffix}'`
  const terminal = terminalNode(window)
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await window.keyboard.type(command)
  await window.keyboard.press('Enter')
  // The complete marker never appears in the typed command, so shell echo cannot satisfy this.
  await expect(terminal).toContainText(expectedOutput)
  await expect
    .poll(async () => {
      return await window.evaluate(
        async ({ nodeId, marker }) => {
          const sessionId = window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(nodeId)
          if (!sessionId) {
            return false
          }
          const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId })
          return snapshot.serializedScreen.includes(marker)
        },
        { nodeId: NODE_ID, marker: expectedOutput },
      )
    })
    .toBe(true)
  return expectedOutput
}

async function expectStaticField(layer: Locator) {
  await expect(layer).toHaveAttribute('data-cove-pixel-motion', 'static')
  await expect(layer).toHaveAttribute('data-cove-pixel-activity', 'idle')
  await expect
    .poll(async () => {
      return await layer.evaluate(canvas => {
        if (!(canvas instanceof HTMLCanvasElement)) {
          return false
        }
        const context = canvas.getContext('2d')
        if (!context || canvas.width === 0 || canvas.height === 0) {
          return false
        }
        return context
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.some((value, index) => index % 4 === 3 && value > 0)
      })
    })
    .toBe(true)
}

test.describe('Workspace Canvas - Spatial Pixel', () => {
  test('persists explicit pixel effects across named theme changes', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seedTerminal(window, 'dark')
      const layer = window.getByTestId('workspace-pixel-layer')
      await expect(layer).toHaveCount(0)

      await openAppearance(window)
      await selectCoveOption(window, 'settings-ui-theme', 'pixel')
      await expect(window.getByTestId('settings-ui-theme-pixel')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expectTheme(window, 'pixel')
      await expect(layer).toHaveCount(0)
      await setPixelEffects(window, PIXEL_EFFECTS_ENABLED)
      await expect(layer).toHaveCount(1)
      await expect(layer).toHaveJSProperty('hidden', false)
      await expect(layer).toHaveAttribute('aria-hidden', 'true')
      await expect(layer).toHaveCSS('pointer-events', 'none')
      await expect(terminalNode(window).locator('.terminal-node__terminal')).toHaveCSS(
        'background-color',
        'rgb(10, 20, 32)',
      )
      await attachScreenshot(window, testInfo, 'spatial-pixel-appearance')
      await window.locator('.settings-panel__close').click()
      await expect(layer).toBeVisible()
      await attachScreenshot(window, testInfo, 'spatial-pixel-workspace')
      await expect.poll(() => readPersistedTheme(window)).toBe('pixel')

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expectTheme(window, 'pixel')
      await expect(layer).toBeVisible()
      await expect(terminalNode(window).locator('.terminal-node__terminal .xterm')).toBeVisible()

      const switchThemeWithEffects = async (theme: 'light' | 'dark') => {
        await openAppearance(window)
        await selectCoveOption(window, 'settings-ui-theme', theme)
        await expectTheme(window, theme)
        await expect(layer).toHaveCount(1)
        await expect(layer).toHaveJSProperty('hidden', false)
        await expect.poll(() => readPixelEffects(window)).toEqual(PIXEL_EFFECTS_ENABLED)
        await window.getByTestId('settings-panel-close').click()
        await expect(layer).toBeVisible()
        await expect(window.locator('.react-flow__background')).toHaveCount(0)
      }
      await switchThemeWithEffects('light')
      await switchThemeWithEffects('dark')
      await openAppearance(window)
      await setPixelEffects(window, PIXEL_EFFECTS_DISABLED)
      await expect(layer).toHaveCount(0)
      await window.getByTestId('settings-panel-close').click()
      await expect(window.locator('.react-flow__background')).toBeVisible()
      await expect.poll(() => readPixelEffects(window)).toEqual(PIXEL_EFFECTS_DISABLED)
    } finally {
      await electronApp.close()
    }
  })

  test('preserves terminal identity, geometry and input when enabling Pixel and using Find', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await seedTerminal(window, 'dark')
      await printThroughTerminal(window, 'BEFORE')
      await expect.poll(() => readTerminalContinuity(window)).toBeTruthy()
      const baseline = await readTerminalContinuity(window)
      expect(baseline?.renderer).toEqual(baseline?.worker)
      const xtermHandle = await terminalNode(window).locator('.xterm').elementHandle()
      expect(xtermHandle).not.toBeNull()

      await openAppearance(window)
      await selectCoveOption(window, 'settings-ui-theme', 'pixel')
      await expectTheme(window, 'pixel')
      await setPixelEffects(window, PIXEL_EFFECTS_ENABLED)
      await window.locator('.settings-panel__close').click()
      await expect.poll(() => readTerminalContinuity(window)).toEqual(baseline)

      const marker = await printThroughTerminal(window, 'ENABLED')
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveAttribute(
        'data-cove-pixel-activity',
        'output',
      )
      await window.keyboard.press(`${findModifier}+f`)
      const findBar = window.getByTestId('terminal-find')
      await expect(findBar).toBeVisible()
      await expect(window.getByTestId('terminal-find-input')).toBeFocused()
      await window.getByTestId('terminal-find-input').fill(marker)
      await expect
        .poll(() =>
          window.evaluate(
            nodeId => window.__opencoveTerminalSelectionTestApi?.getSelection(nodeId) ?? '',
            NODE_ID,
          ),
        )
        .toContain(marker)
      await expect.poll(() => readTerminalContinuity(window)).toEqual(baseline)
      await attachScreenshot(window, testInfo, 'spatial-pixel-terminal-find')

      await window.keyboard.press('Escape')
      await expect(findBar).toBeHidden()
      await printThroughTerminal(window, 'AFTER_FIND')
      await expect.poll(() => readTerminalContinuity(window)).toEqual(baseline)
      if (xtermHandle) {
        expect(
          await xtermHandle.evaluate(
            (element, nodeId) =>
              element.isConnected &&
              element === document.querySelector(`.react-flow__node[data-id="${nodeId}"] .xterm`),
            NODE_ID,
          ),
        ).toBe(true)
      }
    } finally {
      await electronApp.close()
    }
  })

  test('renders a static field for reduced motion while terminal output remains usable', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await window.emulateMedia({ reducedMotion: 'reduce' })
      await seedTerminal(window, 'pixel', 'zh-CN')
      const layer = window.getByTestId('workspace-pixel-layer')
      await expect(layer).toBeVisible()
      // A real terminal click normalizes the viewport; settle that user action before sampling.
      await printThroughTerminal(window, 'REDUCED_READY')
      await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBe(1)
      await expectStaticField(layer)
      const beforeViewport = await readCanvasViewport(window)
      const beforeOutput = await readStableFieldBaseline(layer)
      await printThroughTerminal(window, 'REDUCED')
      await expectStaticField(layer)
      expect(await readCanvasViewport(window)).toEqual(beforeViewport)
      expect(await readFieldSignature(layer)).toBe(beforeOutput)
      await attachScreenshot(window, testInfo, 'spatial-pixel-reduced-motion')

      await openAppearance(window)
      await expect(window.getByTestId('settings-ui-theme-pixel')).toHaveAccessibleName('空间点阵')
    } finally {
      await electronApp.close()
    }
  })
})
