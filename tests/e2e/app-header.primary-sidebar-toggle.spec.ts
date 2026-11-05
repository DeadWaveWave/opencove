import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

async function readCollapsedSetting(page: Page): Promise<boolean | null> {
  return await page.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = raw
      ? (JSON.parse(raw) as { settings?: { isPrimarySidebarCollapsed?: boolean } })
      : null
    return state?.settings?.isPrimarySidebarCollapsed ?? null
  })
}

test.describe('Primary Sidebar Toggle', () => {
  test('hides the entire sidebar and persists header and shortcut toggles', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-toggle-a',
        workspaces: [
          {
            id: 'workspace-toggle-a',
            name: 'OpenCove',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                'agent-toggle',
                'Polish sidebar',
                0,
                'Review UI',
                '2026-09-10T10:00:00.000Z',
              ),
            ],
            spaces: [
              {
                id: 'space-toggle',
                name: 'ui/chrome',
                directoryPath: testWorkspacePath,
                nodeIds: ['agent-toggle'],
              },
            ],
          },
          { id: 'workspace-toggle-b', name: 'Website', path: testWorkspacePath, nodes: [] },
        ],
      })
      const sidebar = window.getByTestId('workspace-sidebar')
      const toggle = window.getByTestId('app-header-sidebar-toggle')
      const rail = window.getByTestId('workspace-project-rail')
      const settings = sidebar.getByTestId('app-header-settings')
      const footer = sidebar.getByTestId('workspace-sidebar-footer')
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(toggle).toHaveAccessibleName('Hide Sidebar')
      await expect(toggle).not.toHaveAttribute('aria-haspopup')
      await expect(settings).toBeVisible()
      await expect(window.locator('.app-header').getByTestId('app-header-settings')).toHaveCount(0)
      expect(
        await footer.evaluate(element => element.parentElement?.lastElementChild === element),
      ).toBe(true)
      const bottomGap = await sidebar.evaluate(element => {
        const footerElement = element.querySelector('.workspace-sidebar__footer')!
        return element.getBoundingClientRect().bottom - footerElement.getBoundingClientRect().bottom
      })
      expect(bottomGap).toBeLessThanOrEqual(12)
      await settings.click()
      await expect(window.getByTestId('settings-panel-search')).toBeFocused()
      await window.getByTestId('settings-panel-close').click()
      await expect(settings).toBeFocused()
      await testInfo.attach('sidebar-bottom-settings', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await expect(rail.locator('.workspace-project-rail__project')).toHaveCount(2)
      await expect(
        window.getByTestId('workspace-project-navigation-workspace-toggle-a'),
      ).toBeVisible()
      await expect(
        window.getByTestId('workspace-project-navigation-workspace-toggle-b'),
      ).toHaveCount(0)

      await toggle.click()
      await expect(sidebar).toHaveClass(/workspace-sidebar--hidden/)
      await expect(sidebar).toBeHidden()
      await expect(sidebar).toHaveCount(1)
      await expect(settings).toBeHidden()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle).toHaveAccessibleName('Show Sidebar')
      await expect
        .poll(() =>
          window.evaluate(() => {
            const shell = document.querySelector('.app-shell')!.getBoundingClientRect()
            const canvas = document.querySelector('.workspace-canvas')!.getBoundingClientRect()
            return canvas.left - shell.left
          }),
        )
        .toBe(0)
      await expect.poll(() => readCollapsedSetting(window)).toBe(true)

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(sidebar).toBeHidden()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      // Restored terminals own focus and intentionally suppress app shortcuts.
      await toggle.press(`${modifier}+B`)
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(toggle).toHaveAccessibleName('Hide Sidebar')
      await expect.poll(() => readCollapsedSetting(window)).toBe(false)
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(sidebar).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await toggle.press(`${modifier}+B`)
      await expect(sidebar).toBeHidden()
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
      await expect(sidebar).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await settings.focus()
      await settings.press('Enter')
      await expect(window.getByTestId('settings-panel-search')).toBeFocused()
      await window.getByTestId('settings-panel-close').click()
      await expect(settings).toBeFocused()
    } finally {
      await electronApp.close()
    }
  })

  test('restores an existing collapsed project and reopens it with reduced motion', async () => {
    const { electronApp, window } = await launchApp()
    try {
      await window.emulateMedia({ reducedMotion: 'reduce' })
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-toggle-existing',
        settings: { isPrimarySidebarCollapsed: true },
        workspaces: [
          {
            id: 'workspace-toggle-existing',
            name: 'Existing project',
            path: testWorkspacePath,
            nodes: [],
          },
        ],
      })
      await expect(window.getByTestId('workspace-sidebar')).toHaveClass(/workspace-sidebar--hidden/)
      await expect(window.getByTestId('workspace-item-workspace-toggle-existing')).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(window.getByTestId('workspace-sidebar')).toBeHidden()
      await expect(window.getByTestId('workspace-sidebar-navigation')).toBeHidden()
      await window.getByTestId('app-header-sidebar-toggle').click()
      await expect(window.getByTestId('workspace-sidebar-navigation')).toBeVisible()
      await expect(
        window.getByTestId('workspace-space-root-workspace-toggle-existing'),
      ).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
