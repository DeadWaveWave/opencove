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

test.describe('Primary Sidebar Pin', () => {
  test('shows only project icons in the rail and persists the pin setting', async ({
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
      const pin = window.getByTestId('workspace-sidebar-pin')
      const rail = window.getByTestId('workspace-project-rail')
      const settings = sidebar.getByTestId('app-header-settings')
      const footer = sidebar.getByTestId('workspace-sidebar-footer')
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
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

      await pin.click()
      await window.mouse.move(800, 450)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      await expect(window.getByTestId('workspace-sidebar-navigation')).toHaveCount(0)
      await expect(rail.locator('.workspace-space-group, .workspace-agent-item')).toHaveCount(0)
      await expect(settings).toBeVisible()
      await settings.focus()
      await settings.press('Enter')
      await expect(window.getByTestId('settings-panel-search')).toBeFocused()
      await window.getByTestId('settings-panel-close').click()
      await expect(settings).toBeFocused()
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect.poll(() => readCollapsedSetting(window), { timeout: 15_000 }).toBe(true)

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect(pin).toHaveAttribute('aria-pressed', 'false')
      await pin.click()
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      await expect(pin).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => readCollapsedSetting(window), { timeout: 15_000 }).toBe(false)
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
    } finally {
      await electronApp.close()
    }
  })

  test('opens an existing persisted collapsed project as a project-only rail', async () => {
    const { electronApp, window } = await launchApp()
    try {
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
      await expect(window.getByTestId('workspace-sidebar')).toHaveClass(/workspace-sidebar--rail/)
      await expect(window.getByTestId('workspace-item-workspace-toggle-existing')).toHaveAttribute(
        'aria-current',
        'page',
      )
      await expect(window.getByTestId('workspace-sidebar-navigation')).toHaveCount(0)
      await window.getByTestId('workspace-sidebar-pin').click()
      await expect(window.getByTestId('workspace-sidebar-navigation')).toBeVisible()
      await expect(
        window.getByTestId('workspace-space-root-workspace-toggle-existing'),
      ).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })
})
