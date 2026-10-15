import { expect, test, type Page } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { TERMINAL_ANSI_THEME_ENTRIES } from '../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalAnsiTheme'
import {
  attachIdentityFrame,
  centerIdentityCanvas,
  clearCanvasSelection,
  createIdentityFixture,
  nodeSelector,
  persistedLabels,
  printIdentityMarker,
  readNodeIdentity,
  readSpaceIdentity,
  seedIdentityFixture,
  selectIdentityTheme,
  terminalIdentity,
} from './workspace-canvas.color-identity.helpers'
import {
  EFFECT_CONTROL_IDS,
  PIXEL_EFFECTS_ENABLED,
  installPixelEffectProbe,
  openPixelAppearance,
  readPixelEffectProbe,
  readPixelEffects,
  setPixelEffect,
  setPixelEffects,
  stopPixelEffectProbe,
} from './workspace-canvas.pixel-effects.helpers'
import { expectSpaceFrameHeader } from './workspace-canvas.space-caption-border.helpers'
import { wheelToZoom } from './workspace-canvas.zoom.helpers'
import { readStableFieldBaseline } from './workspace-canvas.pixel-field.helpers'

async function nodeGeometry(page: Page) {
  return await page.locator('.react-flow__node').evaluateAll(nodes =>
    nodes.map(node => ({
      id: (node as HTMLElement).dataset.id,
      width: (node as HTMLElement).clientWidth,
      height: (node as HTMLElement).clientHeight,
    })),
  )
}

async function readLightPaint(page: Page) {
  return await page.evaluate(ansiEntries => {
    const luminance = (color: string) => {
      const context = document.createElement('canvas').getContext('2d')!
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .reduce((sum, channel, index) => {
          const value = channel / 255
          return (
            sum +
            (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][index]
          )
        }, 0)
    }
    const root = getComputedStyle(document.documentElement)
    const terminal = getComputedStyle(
      document.querySelector('[data-id="pixel-material-terminal"] .terminal-node__terminal')!,
    )
    const monaco = getComputedStyle(
      document.querySelector('.document-node .monaco-editor-background')!,
    )
    // The editor is transparent and reads on the document's reading plate.
    const plate = getComputedStyle(
      document.querySelector('.document-node [data-cove-part="window-body"]')!,
    )
    const background = terminal.backgroundColor
    const foreground = root.getPropertyValue('--cove-terminal-foreground').trim()
    const back = luminance(background)
    const front = luminance(foreground)
    return {
      app: luminance(root.getPropertyValue('--cove-app-background').trim()),
      terminal: {
        background,
        foreground,
        luminance: back,
        contrast: (Math.max(back, front) + 0.05) / (Math.min(back, front) + 0.05),
      },
      monaco: luminance(plate.backgroundColor),
      monacoBackground: monaco.backgroundColor,
      ansi: ansiEntries.map(([name, token]) => {
        const color = terminal.getPropertyValue(token).trim()
        const light = luminance(color)
        return {
          name,
          color,
          contrast: (Math.max(light, back) + 0.05) / (Math.min(light, back) + 0.05),
        }
      }),
    }
  }, TERMINAL_ANSI_THEME_ENTRIES)
}

async function printAnsiPalette(page: Page) {
  const terminal = page.locator(`${nodeSelector('terminal')} .terminal-node`)
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type(
    buildNodeEvalCommand(`
    const esc = String.fromCharCode(27);
    const colors = ['black','red','green','yellow','blue','magenta','cyan','white'];
    const sample = (code, label) => esc + '[' + code + 'm' + label.padEnd(17) + esc + '[0m';
    const lines = colors.map((color, index) => sample(30 + index, color) + sample(90 + index, 'bright ' + color));
    process.stdout.write(esc + '[2J' + esc + '[H' + ['Pixel Light - ANSI 16', ...lines, ['ANSI16','READY'].join('_')].join(String.fromCharCode(10)) + String.fromCharCode(10));
  `),
  )
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText('ANSI16_READY')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const lines =
          window.__opencoveTerminalSelectionTestApi
            ?.getBufferText('pixel-material-terminal', 'ANSI16_READY')
            ?.viewportLines.join('\n') ?? ''
        return ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].every(
          color => lines.includes('bright ' + color),
        )
      }),
    )
    .toBe(true)
  await clearCanvasSelection(page)
}

async function pixelFrame(page: Page) {
  return await page.getByTestId('workspace-pixel-layer').evaluate(async element => {
    const canvas = element as HTMLCanvasElement
    const sample = () => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let hash = 2166136261,
        painted = 0
      for (let index = 0; index < pixels.length; index++) {
        hash = Math.imul(hash ^ pixels[index], 16777619)
        if (index % 4 === 3 && pixels[index] > 0) {
          painted++
        }
      }
      return { hash, painted }
    }
    const before = sample()
    await new Promise<void>(resolve => {
      let remaining = 6
      const next = () => {
        if (--remaining === 0) {
          resolve()
        } else {
          requestAnimationFrame(next)
        }
      }
      requestAnimationFrame(next)
    })
    return { before, after: sample() }
  })
}

test.describe('Workspace Canvas - Pixel Light', () => {
  test.setTimeout(180_000)

  test('switches existing Pixel work into a readable light canvas and terminal without replacing editors', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const fixture = await createIdentityFixture()
    for (const node of fixture.nodes) {
      if (node.kind === 'terminal' || node.kind === 'document') {
        node.labelColorOverride = 'none'
      }
    }
    const { electronApp, window: page } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
    })
    try {
      await (
        await electronApp.browserWindow(page)
      ).evaluate(window => window.setContentSize(1800, 1200))
      await seedIdentityFixture(page, fixture)
      await printIdentityMarker(page)
      const geometry = await nodeGeometry(page)
      const identity = await terminalIdentity(page)
      const labels = (await readNodeIdentity(page)).map(node => node.label)
      const savedLabels = await persistedLabels(page)
      const xterm = await page.locator(`${nodeSelector('terminal')} .xterm`).elementHandle()
      const monaco = await page
        .locator(`${nodeSelector('document')} .monaco-editor`)
        .elementHandle()
      expect(identity.sessionId).toBeTruthy()
      expect(xterm).not.toBeNull()
      expect(monaco).not.toBeNull()
      await selectIdentityTheme(page, 'pixel-light')
      await expect(page.locator('html')).toHaveAttribute('data-cove-theme', 'light')
      await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
      await expect(
        page.locator(`${nodeSelector('terminal')} .terminal-node__terminal`),
      ).toHaveAttribute('data-cove-terminal-theme', 'light')
      const nodes = await readNodeIdentity(page)
      expect(nodes).toHaveLength(8)
      expect(nodes.map(node => node.label)).toEqual(labels)
      for (const node of nodes) {
        expect(node.ribbonImage).toContain('linear-gradient')
        if (node.kind !== 'image') {
          expect(node.contrast, `${node.kind} title`).toBeGreaterThanOrEqual(4.5)
        }
        if (node.label === null) {
          expect(Object.values(node.identity)).toEqual(node.themePalette)
        }
      }
      expect(nodes.find(node => node.kind === 'agent')?.providerIcon?.provider).toBe('codex')
      const paint = await readLightPaint(page)
      expect(paint.app).toBeGreaterThan(0.7)
      expect(paint.terminal.luminance).toBeGreaterThan(0.7)
      expect(paint.terminal.contrast).toBeGreaterThanOrEqual(4.5)
      expect(paint.monaco).toBeGreaterThan(0.7)
      expect(paint.monacoBackground).toBe('rgba(0, 0, 0, 0)')
      expect(paint.ansi).toHaveLength(16)
      for (const color of paint.ansi) {
        expect(color.color, `${color.name} ANSI override`).toBeTruthy()
        expect(
          color.contrast,
          `${color.name} on ${paint.terminal.background}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
      await expectSpaceFrameHeader(page)
      await expect(page.getByTestId('workspace-pixel-layer')).toBeVisible()
      await expect.poll(() => readPixelEffects(page)).toEqual(PIXEL_EFFECTS_ENABLED)
      await printAnsiPalette(page)
      await attachIdentityFrame(page, testInfo, 'pixel-light-all-node-kinds')
      await testInfo.attach('pixel-light-ansi16-terminal', {
        body: await page.locator(`${nodeSelector('terminal')} .terminal-node`).screenshot(),
        contentType: 'image/png',
      })
      await testInfo.attach('pixel-light-paint-metrics', {
        body: JSON.stringify({ paint, nodes }, null, 2),
        contentType: 'application/json',
      })
      await wheelToZoom(page, 0.2)
      await expectSpaceFrameHeader(page)
      const spaces = await readSpaceIdentity(page)
      expect(spaces.every(space => space.fill.alpha < 0.01 && space.labelScreenFont >= 8)).toBe(
        true,
      )
      const restore = await centerIdentityCanvas(page)
      await attachIdentityFrame(page, testInfo, 'pixel-light-overview')
      await restore()
      await wheelToZoom(page, 1)
      expect(await terminalIdentity(page)).toEqual(identity)
      expect(await nodeGeometry(page)).toEqual(geometry)
      await printIdentityMarker(page)
      await selectIdentityTheme(page, 'pixel')
      await expect(
        page.locator(`${nodeSelector('terminal')} .terminal-node__terminal`),
      ).toHaveAttribute('data-cove-terminal-theme', 'dark')
      expect((await readLightPaint(page)).ansi.every(color => color.color === '')).toBe(true)
      expect(await terminalIdentity(page)).toEqual(identity)
      expect(await nodeGeometry(page)).toEqual(geometry)
      expect(await xterm!.evaluate(element => element.isConnected)).toBe(true)
      expect(await monaco!.evaluate(element => element.isConnected)).toBe(true)
      expect(await persistedLabels(page)).toEqual(savedLabels)
      await printIdentityMarker(page)
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })

  test('persists Pixel Light from Control Center while respecting independent effects and reduced motion', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(
        page,
        [
          {
            id: 'pixel-light-context',
            kind: 'note',
            title: 'Context',
            position: { x: 480, y: 160 },
            width: 320,
            height: 240,
            task: { text: 'Theme changes preserve this context.' },
          },
        ],
        {
          settings: {
            uiTheme: 'pixel',
            language: 'en',
            ...PIXEL_EFFECTS_ENABLED,
            focusNodeOnClick: false,
          },
        },
      )
      await openPixelAppearance(page)
      await setPixelEffect(page, 'nodeClosePixelEffectEnabled', false)
      await setPixelEffect(page, 'canvasPixelBackgroundEnabled', false)
      await page.locator('.settings-panel__close').click()
      await page.getByTestId('app-header-control-center').click()
      await page.getByTestId('control-center-theme-pixel-light').click()
      await expect(page.getByTestId('control-center-theme-pixel-light')).toBeChecked()
      await expect(page.getByTestId('control-center-current-theme')).toContainText('Pixel Light')
      await attachIdentityFrame(page, testInfo, 'pixel-light-control-center')
      await page.keyboard.press('Escape')
      const mixed = {
        ...PIXEL_EFFECTS_ENABLED,
        nodeClosePixelEffectEnabled: false,
        canvasPixelBackgroundEnabled: false,
      }
      await expect.poll(() => readPixelEffects(page)).toEqual(mixed)
      // The unchanged effect flags can already match the old snapshot. Wait for
      // the new theme itself to be durably saved before discarding the renderer.
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            return raw
              ? (JSON.parse(raw) as { settings?: { uiTheme?: string } }).settings?.uiTheme
              : null
          }),
        )
        .toBe('pixel-light')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('html')).toHaveAttribute('data-cove-theme-id', 'pixel-light')
      await expect(page.locator('html')).toHaveAttribute('data-cove-theme', 'light')
      await expect.poll(() => readPixelEffects(page)).toEqual(mixed)
      await expect(page.getByTestId('workspace-pixel-layer')).toBeHidden()
      await expect(page.locator('.react-flow__background')).toBeVisible()
      await openPixelAppearance(page)
      await Promise.all(
        Object.entries(EFFECT_CONTROL_IDS).map(([key, id]) =>
          expect(page.getByTestId(id)).toHaveJSProperty(
            'checked',
            mixed[key as keyof typeof mixed],
          ),
        ),
      )
      await attachIdentityFrame(page, testInfo, 'pixel-light-settings')
      await setPixelEffects(page, PIXEL_EFFECTS_ENABLED)
      await page.locator('.settings-panel__close').click()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page.getByTestId('workspace-pixel-layer')).toHaveAttribute(
        'data-cove-pixel-motion',
        'static',
      )
      // Settle the last invalidation and Chromium's readback rasterization before
      // the strict idle comparison. Creating a node later deliberately pans this field.
      await readStableFieldBaseline(page.getByTestId('workspace-pixel-layer'))
      const field = await pixelFrame(page)
      expect(field.before.painted).toBeGreaterThan(20)
      expect(field.after).toEqual(field.before)
      await installPixelEffectProbe(page)
      await page
        .locator('.workspace-canvas .react-flow__pane')
        .click({ button: 'right', position: { x: 200, y: 180 } })
      await page.getByTestId('workspace-context-new-note').click()
      const note = page.locator(
        '.react-flow__node:not([data-id="pixel-light-context"]):has(.note-node)',
      )
      await expect(note).toHaveCount(1)
      await expect(note.getByTestId('note-node-textarea')).toBeFocused()
      await expect(note).toHaveCSS('mask-image', 'none')
      const id = await note.getAttribute('data-id')
      expect(id).toBeTruthy()
      // Observe creation before typing: real input cancels any active reveal.
      await pixelFrame(page)
      await page.keyboard.insertText('Immediately ready in Pixel Light.')
      await expect(note.getByTestId('note-node-textarea')).toHaveValue(
        'Immediately ready in Pixel Light.',
      )
      await note.locator('.note-node__close').click()
      await expect(note).toHaveCount(0)
      await pixelFrame(page)
      const observed = await readPixelEffectProbe(page)
      expect(observed.created[id!]).toMatchObject({ focused: true, masked: false, rim: false })
      expect(observed.bursts).not.toContain(id)
      await expect.poll(() => readPixelEffects(page)).toEqual(PIXEL_EFFECTS_ENABLED)
      await expect(page.locator('.workspace-selection-hint')).toHaveCount(0)
      await attachIdentityFrame(page, testInfo, 'pixel-light-reduced-motion')
    } finally {
      await stopPixelEffectProbe(page).catch(() => undefined)
      await electronApp.close()
    }
  })
})
