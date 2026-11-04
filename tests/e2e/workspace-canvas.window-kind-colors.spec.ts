import { expect, test, type Page } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

async function readTerminalTile(window: Page) {
  return await window
    .locator('.react-flow__node[data-id="kind-colour-terminal"] [data-cove-part="kind-tile"]')
    .evaluate(tile => {
      const style = getComputedStyle(tile)
      const probe = document.createElement('span')
      probe.style.backgroundColor = style.getPropertyValue('--cove-kind-neutral-tile')
      document.body.append(probe)
      const neutral = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        kind: (tile as HTMLElement).dataset.kind,
        background: style.backgroundColor,
        neutral,
      }
    })
}

test('window kind colours colour the tile and can be turned off in Settings', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: 'kind-colour-terminal',
          title: 'Kind colours',
          position: { x: 120, y: 120 },
          width: 460,
          height: 300,
        },
      ],
      { settings: { uiTheme: 'dark' } },
    )
    await expect(window.locator('html')).toHaveAttribute('data-cove-family', 'cove')
    await expect(window.locator('html')).toHaveAttribute('data-cove-kind-colors', 'on')

    const on = await readTerminalTile(window)
    expect(on.kind).toBe('shell')
    expect(on.background).not.toBe(on.neutral)

    await window.getByTestId('app-header-settings').click()
    await window.getByTestId('settings-section-nav-appearance').click()
    const toggle = window.getByTestId('settings-window-kind-colors')
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await window.getByTestId('settings-panel-close').click()

    await expect(window.locator('html')).toHaveAttribute('data-cove-kind-colors', 'off')
    const off = await readTerminalTile(window)
    expect(off.kind).toBe('shell')
    expect(off.background).toBe(off.neutral)
    await expect
      .poll(async () =>
        window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          return raw ? JSON.parse(raw).settings?.windowKindColorsEnabled : null
        }),
      )
      .toBe(false)
  } finally {
    await electronApp.close()
  }
})
