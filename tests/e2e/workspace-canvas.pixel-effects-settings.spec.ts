import { expect, test, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  selectCoveOption,
} from './workspace-canvas.helpers'
import {
  EFFECT_CONTROL_IDS,
  PIXEL_EFFECTS_DISABLED,
  PIXEL_EFFECTS_ENABLED,
  installPixelEffectProbe,
  openPixelAppearance,
  readPixelEffectProbe,
  readPixelEffects,
  setPixelEffect,
  setPixelEffects,
  stopPixelEffectProbe,
} from './workspace-canvas.pixel-effects.helpers'

async function attachFrame(page: Page, testInfo: TestInfo, name: string) {
  const output = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: output, animations: 'allow' })
  await testInfo.attach(name, { path: output, contentType: 'image/png' })
}

async function readFieldColor(page: Page) {
  return await page.getByTestId('workspace-pixel-layer').evaluate(element => {
    const canvas = element as HTMLCanvasElement
    const pixels =
      canvas.width && canvas.height
        ? canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        : null
    let red = 0,
      green = 0,
      blue = 0,
      count = 0
    if (pixels) {
      for (let index = 0; index < pixels.length; index += 8) {
        if (pixels[index + 3]! <= 8) {
          continue
        }
        red += pixels[index]!
        green += pixels[index + 1]!
        blue += pixels[index + 2]!
        count++
      }
    }
    return {
      red: red / Math.max(1, count),
      green: green / Math.max(1, count),
      blue: blue / Math.max(1, count),
      count,
    }
  })
}

async function createNode(page: Page, kind: 'note' | 'terminal', x = 240) {
  const before = await page
    .locator('.react-flow__node')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))
  await page
    .locator('.workspace-canvas .react-flow__pane')
    .click({ button: 'right', position: { x, y: 170 } })
  const selected = await page
    .locator('.react-flow__node.selected')
    .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))
  const action = page.getByTestId(`workspace-context-new-${kind}`)
  await expect(action).toBeVisible()
  await action.click()
  const created = page.locator(`.react-flow__node:has(.${kind}-node)`)
  await expect
    .poll(
      async () =>
        (
          await page
            .locator('.react-flow__node')
            .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))
        ).filter(id => !before.includes(id)).length,
    )
    .toBe(1)
  const id = await created.evaluateAll(
    (nodes, known) =>
      nodes.find(node => !known.includes(node.getAttribute('data-id')))?.getAttribute('data-id') ??
      '',
    before,
  )
  expect(id).toBeTruthy()
  expect(
    await page
      .locator('.react-flow__node.selected')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id'))),
  ).toEqual(selected)
  return id
}

test.describe('Independent pixel effects settings', () => {
  test('persists four independent switches across theme changes and reloads', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'existing-note',
            title: 'Existing context',
            kind: 'note',
            position: { x: 160, y: 160 },
            width: 320,
            height: 220,
            task: { text: 'Enabling an effect does not recreate this node.' },
          },
        ],
        { settings: { uiTheme: 'dark', language: 'zh-CN', ...PIXEL_EFFECTS_DISABLED } },
      )
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveCount(0)
      await expect(window.locator('.react-flow__background')).toBeVisible()
      await openPixelAppearance(window)
      await Promise.all(
        Object.values(EFFECT_CONTROL_IDS).map(id =>
          expect(window.getByTestId(id)).not.toBeChecked(),
        ),
      )
      await setPixelEffect(window, 'nodeCreationPixelEffectEnabled', true)
      await expect(window.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
        'data-cove-pixel-assembly',
        'idle',
      )
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveCount(1)
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveJSProperty('hidden', true)
      await expect(window.locator('.react-flow__background')).toHaveCount(1)
      await expect
        .poll(() => readPixelEffects(window))
        .toEqual({
          ...PIXEL_EFFECTS_DISABLED,
          nodeCreationPixelEffectEnabled: true,
        })
      await window.getByTestId('settings-panel-close').click()
      await expect(window.locator('.react-flow__background')).toBeVisible()
      await expect(window.getByTestId('workspace-pixel-layer')).toBeHidden()
      await openPixelAppearance(window)
      await setPixelEffect(window, 'nodeClosePixelEffectEnabled', true)
      await setPixelEffect(window, 'canvasPixelBackgroundEnabled', true)
      await setPixelEffect(window, 'agentWorkingPixelEffectEnabled', true)
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveCount(1)
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveJSProperty('hidden', false)
      await expect(window.locator('.react-flow__background')).toHaveCount(0)
      await setPixelEffect(window, 'nodeCreationPixelEffectEnabled', false)
      const mixed = { ...PIXEL_EFFECTS_ENABLED, nodeCreationPixelEffectEnabled: false }
      await expect.poll(() => readPixelEffects(window)).toEqual(mixed)
      await attachFrame(window, testInfo, 'pixel-effects-independent-switches')
      await selectCoveOption(window, 'settings-ui-theme', 'light')
      await window.locator('.settings-panel__close').click()
      await expect(window.getByTestId('workspace-pixel-layer')).toBeVisible()
      await expect(window.locator('.react-flow__background')).toHaveCount(0)
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => readPixelEffects(window)).toEqual(mixed)
      await expect(window.getByTestId('workspace-pixel-layer')).toBeVisible()
      await expect(window.locator('.react-flow__background')).toHaveCount(0)
      await expect(window.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
        'data-cove-pixel-assembly',
        'idle',
      )
      await openPixelAppearance(window)
      await setPixelEffects(window, PIXEL_EFFECTS_DISABLED)
      await selectCoveOption(window, 'settings-ui-theme', 'pixel')
      await window.locator('.settings-panel__close').click()
      await expect.poll(() => readPixelEffects(window)).toEqual(PIXEL_EFFECTS_DISABLED)
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveCount(0)
      await expect(window.getByTestId('workspace-pixel-assembly')).toHaveCount(0)
      await expect(window.locator('.react-flow__background')).toBeVisible()
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveCount(0)
      await expect(window.locator('.react-flow__background')).toBeVisible()
    } finally {
      await electronApp.close()
    }
  })

  test('uses the selected theme palette in every theme while enabled effects stay enabled', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'palette-note',
            title: 'Palette context',
            kind: 'note',
            position: { x: 200, y: 160 },
            width: 360,
            height: 240,
            task: { text: 'The same context, with theme-adaptive pixel effects.' },
          },
        ],
        { settings: { uiTheme: 'dark', ...PIXEL_EFFECTS_ENABLED } },
      )
      const inspect = async (theme: string, base: 'dark' | 'light') => {
        await openPixelAppearance(window)
        await selectCoveOption(window, 'settings-ui-theme', theme)
        await window.locator('.settings-panel__close').click()
        await expect(window.locator('html')).toHaveAttribute('data-cove-theme', base)
        await expect(window.getByTestId('workspace-pixel-layer')).toBeVisible()
        await expect
          .poll(async () => {
            const color = await readFieldColor(window)
            return color.count > 20 && color.blue > color.red
          })
          .toBe(true)
        await expect.poll(() => readPixelEffects(window)).toEqual(PIXEL_EFFECTS_ENABLED)
        await expect(window.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
          'data-cove-pixel-assembly',
          'idle',
        )
        await expect(window.locator('[data-id="palette-note"]')).toHaveCSS('mask-image', 'none')
        await attachFrame(window, testInfo, `pixel-effects-${theme}-${base}`)
      }
      await inspect('dark', 'dark')
      await inspect('light', 'light')
      await inspect('pixel', 'dark')
      await inspect('pixel-light', 'light')
      await window.emulateMedia({ colorScheme: 'light' })
      await inspect('system', 'light')
      await window.emulateMedia({ colorScheme: 'dark' })
      await expect(window.locator('html')).toHaveAttribute('data-cove-theme', 'dark')
      await expect.poll(() => readPixelEffects(window)).toEqual(PIXEL_EFFECTS_ENABLED)
      await attachFrame(window, testInfo, 'pixel-effects-system-dark')
    } finally {
      await electronApp.close()
    }
  })

  test('shares focused Note and Terminal creation rims and close scatter without a background or canvas selection count', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const videoDirectory = process.env.OPENCOVE_E2E_PIXEL_EFFECTS_VIDEO_DIR
    const { electronApp, window } = await launchApp({
      ...(videoDirectory
        ? { recordVideo: { dir: videoDirectory, size: { width: 1440, height: 900 } } }
        : {}),
    })
    const video = window.video()
    try {
      await clearAndSeedWorkspace(window, [], {
        settings: {
          uiTheme: 'light',
          language: 'en',
          ...PIXEL_EFFECTS_ENABLED,
          canvasPixelBackgroundEnabled: false,
          terminalFontSize: 14,
          focusNodeOnClick: false,
          standardWindowSizeBucket: 'compact',
        },
      })
      await openPixelAppearance(window)
      await window.getByTestId('settings-canvas-pixel-background').scrollIntoViewIfNeeded()
      await attachFrame(window, testInfo, 'pixel-effects-foreground-only-settings')
      if (videoDirectory) {
        await window.waitForTimeout(1200)
      }
      await window.locator('.settings-panel__close').click()
      await installPixelEffectProbe(window)
      const verifyCreation = async (kind: 'note' | 'terminal', x: number) => {
        const id = await createNode(window, kind, x)
        const frame = window.locator(`.react-flow__node[data-id="${id}"]`)
        const input =
          kind === 'note'
            ? frame.getByTestId('note-node-textarea')
            : frame.locator('.xterm-helper-textarea')
        await expect(input).toBeFocused()
        await expect
          .poll(async () => (await readPixelEffectProbe(window)).created[id]?.rim)
          .toBe(true)
        const node = frame.locator(`.${kind}-node`)
        const expectedBorder = await node.evaluate(element => {
          const token = getComputedStyle(element)
            .getPropertyValue('--cove-node-selection-border')
            .trim()
          const probe = document.createElement('span')
          probe.hidden = true
          probe.style.color = token
          document.body.append(probe)
          const color = getComputedStyle(probe).color
          probe.remove()
          return color
        })
        await expect(node).toHaveCSS('border-top-color', expectedBorder)
        await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
        await expect(window.locator('.react-flow__background')).toBeVisible()
        await expect(window.getByTestId('workspace-pixel-layer')).toBeHidden()
        if (videoDirectory) {
          await expect(frame).toHaveCSS('mask-image', 'none')
          await window.waitForTimeout(200)
        }
        if (kind === 'note') {
          await window.keyboard.insertText('Input focus stays ready while pixels form.')
          await expect(input).toHaveValue('Input focus stays ready while pixels form.')
        } else {
          await window.keyboard.type(
            process.platform === 'win32'
              ? buildNodeEvalCommand("process.stdout.write(['EFFECTS','READY'].join('_') + '\\n')")
              : "printf '%s_%s\\n' 'EFFECTS' 'READY'",
          )
          await window.keyboard.press('Enter')
          await expect(frame).toContainText('EFFECTS_READY')
        }
        await expect(frame).toHaveCSS('mask-image', 'none')
        await attachFrame(window, testInfo, `pixel-effects-${kind}-focused`)
        if (videoDirectory) {
          await window.waitForTimeout(700)
        }
        await frame.locator(`.${kind}-node__close`).click()
        await expect
          .poll(async () => (await readPixelEffectProbe(window)).bursts.includes(id))
          .toBe(true)
        await attachFrame(window, testInfo, `pixel-effects-${kind}-close-scatter`)
        await expect(window.getByTestId('workspace-pixel-assembly')).toHaveAttribute(
          'data-cove-pixel-burst',
          'idle',
        )
      }
      await verifyCreation('note', 220)
      await verifyCreation('terminal', 580)
      await window.emulateMedia({ reducedMotion: 'reduce' })
      const reducedId = await createNode(window, 'note')
      const note = window.locator(`[data-id="${reducedId}"]`)
      await expect(note.getByTestId('note-node-textarea')).toBeFocused()
      await expect(note).toHaveCSS('mask-image', 'none')
      await window.keyboard.insertText('Reduced motion remains immediately usable.')
      await expect(note.getByTestId('note-node-textarea')).toHaveValue(
        'Reduced motion remains immediately usable.',
      )
      await note.locator('.note-node__close').click()
      await window.waitForTimeout(500)
      const observed = await readPixelEffectProbe(window)
      expect(observed.created[reducedId]?.rim).toBe(false)
      expect(observed.bursts).not.toContain(reducedId)
      await openPixelAppearance(window)
      await setPixelEffects(window, PIXEL_EFFECTS_DISABLED)
      await window.locator('.settings-panel__close').click()
      await window.emulateMedia({ reducedMotion: 'no-preference' })
      await expect(window.getByTestId('workspace-pixel-assembly')).toHaveCount(0)
      const plainId = await createNode(window, 'note')
      const plain = window.locator(`[data-id="${plainId}"]`)
      await expect(plain.getByTestId('note-node-textarea')).toBeFocused()
      await window.keyboard.insertText('No effects are required to start typing.')
      await expect(plain.getByTestId('note-node-textarea')).toHaveValue(
        'No effects are required to start typing.',
      )
      await expect(plain).toHaveCSS('mask-image', 'none')
      await expect(window.locator('.react-flow__node.selected')).toHaveCount(0)
      await expect(window.getByTestId('workspace-pixel-layer')).toHaveCount(0)
      await attachFrame(window, testInfo, 'pixel-effects-off-input-ready')
      await testInfo.attach('pixel-effects-observations', {
        body: JSON.stringify(observed, null, 2),
        contentType: 'application/json',
      })
    } finally {
      await stopPixelEffectProbe(window).catch(() => undefined)
      await electronApp.close()
      if (videoDirectory && video) {
        const output = path.join(videoDirectory, 'pixel-effects-independent.webm')
        await video.saveAs(output)
        await testInfo.attach('pixel-effects-independent', {
          path: output,
          contentType: 'video/webm',
        })
      }
    }
  })
})
