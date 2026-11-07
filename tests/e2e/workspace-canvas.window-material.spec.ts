import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

/**
 * The note's glass frame alpha, whether its glass is lit (sheen and grain on the frame, a rim on
 * its ::before) and how many elements still blur what is behind them.
 */
async function readMaterials(window: Page) {
  return await window.evaluate(() => {
    const note = document.querySelector(
      '.react-flow__node[data-id="reduce-transparency-note"] .note-node',
    )
    const background = note ? getComputedStyle(note).backgroundColor : ''
    const white = /rgba\(255, 255, 255, 0\.\d+\)/
    const image = note ? getComputedStyle(note).backgroundImage : ''
    const rim = note ? getComputedStyle(note, '::before').backgroundImage : ''
    const lit = image.includes('url("blob:') && white.test(image) && white.test(rim)
    // rgba(…, a), or `color(srgb … / a)` for color-mix(); opaque colours carry no alpha.
    const alpha = (/\/\s*([\d.]+)\s*\)$/.exec(background) ??
      /rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(background))?.[1]
    const blurred = [...document.querySelectorAll('*')].filter(element =>
      ['', '::before', '::after'].some(pseudo => {
        const filter = getComputedStyle(element, pseudo || null).backdropFilter
        return filter !== '' && filter !== 'none'
      }),
    ).length
    return {
      attribute: document.documentElement.dataset.coveTransparency,
      alpha: alpha === undefined ? 1 : Number(alpha),
      blurred,
      lit,
    }
  })
}

test('the window material turns glass solid from Settings, the control center and the system', async () => {
  const { electronApp, window } = await launchApp()
  try {
    const session = await window.context().newCDPSession(window)
    const emulateSystem = (value: 'no-preference' | 'reduce') =>
      session.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-transparency', value }],
      })
    await emulateSystem('no-preference')
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: 'reduce-transparency-note',
          title: 'Glass',
          position: { x: 120, y: 120 },
          width: 360,
          height: 240,
          kind: 'note',
          task: { text: 'Glass' },
        },
      ],
      { settings: { uiTheme: 'dark' } },
    )
    await expect(window.locator('html')).toHaveAttribute('data-cove-family', 'cove')
    await expect(window.locator('.note-node')).toHaveCount(1)

    const glass = await readMaterials(window)
    expect(glass.attribute).toBe('full')
    expect(glass.alpha).toBeLessThan(1)
    expect(glass.blurred).toBeGreaterThan(0)
    expect(glass.lit).toBe(true)

    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-appearance').click()
    const glassOption = window.getByTestId('settings-window-material-glass')
    const solidOption = window.getByTestId('settings-window-material-solid')
    await expect(glassOption).toBeChecked()
    await solidOption.check()
    await window.getByTestId('settings-panel-close').click()
    await expect
      .poll(() => readMaterials(window))
      .toEqual({ attribute: 'reduced', alpha: 1, blurred: 0, lit: false })
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          return raw ? (JSON.parse(raw).settings?.windowMaterial ?? null) : null
        }),
      )
      .toBe('solid')

    // The control center writes the same setting.
    await window.getByTestId('app-header-control-center').click()
    await expect(window.getByTestId('control-center-window-material-solid')).toBeChecked()
    await window.getByTestId('control-center-window-material-glass').check()
    await window.keyboard.press('Escape')
    await expect.poll(async () => (await readMaterials(window)).attribute).toBe('full')

    // While the system reduces transparency, windows are solid and glass is unavailable.
    await emulateSystem('reduce')
    await expect
      .poll(() => readMaterials(window))
      .toEqual({ attribute: 'reduced', alpha: 1, blurred: 0, lit: false })
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-appearance').click()
    await expect(solidOption).toBeChecked()
    await expect(glassOption).toBeDisabled()
    await window.getByTestId('settings-panel-close').click()
    await emulateSystem('no-preference')
    await expect.poll(async () => (await readMaterials(window)).attribute).toBe('full')
  } finally {
    await electronApp.close()
  }
})
