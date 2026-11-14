import { expect, test, type Locator } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

/** The drawn colour of an icon and whether anything paints a chip behind it. */
function readMark(icon: Locator): Promise<{ color: string; chip: string | null }> {
  return icon.evaluate(element => {
    const mark = element.querySelector('svg') ?? element
    const style = getComputedStyle(element)
    const chip =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderTopWidth !== '0px'
        ? `${style.backgroundColor} ${style.borderTopWidth} ${style.borderRadius}`
        : null
    return { color: getComputedStyle(mark).color, chip }
  })
}

test.describe('Workspace Canvas - Agent provider marks', () => {
  test('dock and menus draw provider logos bare, in the ink of the icons beside them', async () => {
    const { electronApp, window } = await launchApp()

    try {
      for (const uiTheme of ['dark', 'light'] as const) {
        await clearAndSeedWorkspace(window, [], { settings: { uiTheme } })
        await expect
          .poll(() => window.evaluate(() => document.documentElement.dataset.coveTheme ?? null))
          .toBe(uiTheme)

        const dockAgent = await readMark(
          window
            .getByTestId('workspace-canvas-action-bar-new-agent')
            .locator('.agent-provider-icon'),
        )
        const dockTerminal = await readMark(
          window.getByTestId('workspace-canvas-action-bar-new-terminal').locator('svg'),
        )
        expect(dockAgent, `${uiTheme} dock`).toEqual({ color: dockTerminal.color, chip: null })

        await window
          .locator('.react-flow__pane')
          .first()
          .click({ button: 'right', position: { x: 260, y: 180 } })
        const runAgentIcon = await readMark(
          window
            .getByTestId('workspace-context-run-default-agent')
            .locator('.cove-menu-item__icon'),
        )
        await window.getByTestId('workspace-context-run-agent-provider-toggle').click()
        const submenu = window.getByTestId('workspace-context-run-agent-provider-menu')
        await expect(submenu).toBeVisible()
        const marks = submenu.locator('.agent-provider-icon')
        expect(await marks.count()).toBeGreaterThan(0)
        // A vendor bitmap would keep its own colours whatever the theme.
        await expect(submenu.locator('img')).toHaveCount(0)
        for (const mark of await marks.all()) {
          expect(
            await readMark(mark),
            `${uiTheme} ${await mark.getAttribute('data-agent-provider')}`,
          ).toEqual({ color: runAgentIcon.color, chip: null })
        }

        // Hovered, a logo brightens with its row like any menu icon.
        const first = submenu.getByRole('menuitem').first()
        await first.hover()
        const label = await first
          .locator('.cove-menu-item__label')
          .evaluate(element => getComputedStyle(element).color)
        await expect
          .poll(async () => (await readMark(first.locator('.agent-provider-icon'))).color)
          .toBe(label)

        await window.keyboard.press('Escape')
        await window.keyboard.press('Escape')
      }
    } finally {
      await electronApp.close()
    }
  })
})
