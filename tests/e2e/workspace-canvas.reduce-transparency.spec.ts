import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

/** The note's glass frame alpha and how many elements still blur what is behind them. */
async function readMaterials(window: Page) {
  return await window.evaluate(() => {
    const note = document.querySelector(
      '.react-flow__node[data-id="reduce-transparency-note"] .note-node',
    )
    const background = note ? getComputedStyle(note).backgroundColor : ''
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
    }
  })
}

test('reduce transparency makes glass solid from Settings and from the system', async () => {
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

    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-appearance').click()
    const toggle = window.getByTestId('settings-reduce-transparency')
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await window.getByTestId('settings-panel-close').click()
    await expect
      .poll(() => readMaterials(window))
      .toEqual({ attribute: 'reduced', alpha: 1, blurred: 0 })
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          return raw ? (JSON.parse(raw).settings?.reduceTransparency ?? null) : null
        }),
      )
      .toBe(true)

    // Turned off again, the app follows the system: live, with the switch locked on.
    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-appearance').click()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect.poll(async () => (await readMaterials(window)).attribute).toBe('full')
    await emulateSystem('reduce')
    await expect(toggle).toBeChecked()
    await expect(toggle).toBeDisabled()
    await window.getByTestId('settings-panel-close').click()
    await expect
      .poll(() => readMaterials(window))
      .toEqual({ attribute: 'reduced', alpha: 1, blurred: 0 })
    await emulateSystem('no-preference')
    await expect.poll(async () => (await readMaterials(window)).attribute).toBe('full')
  } finally {
    await electronApp.close()
  }
})
