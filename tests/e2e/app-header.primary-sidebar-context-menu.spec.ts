import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

const workspaceId = 'workspace-sidebar-context-menu'
const spaceId = 'space-sidebar-context-menu'
const agentId = 'agent-sidebar-context-menu'

async function movePointerIntoMenuOutsideSidebar(page: Page, menu: Locator): Promise<void> {
  const [menuRect, sidebarRect] = await Promise.all([
    menu.evaluate(element => element.getBoundingClientRect().toJSON()),
    page
      .locator('.workspace-sidebar')
      .evaluate(element => element.getBoundingClientRect().toJSON()),
  ])
  const x = Math.max(sidebarRect.right + 8, menuRect.right - 12)
  const y = menuRect.top + Math.min(menuRect.height / 2, 40)
  await page.mouse.move(x, y)
}

async function openMenuFromPeek({
  page,
  sidebar,
  target,
}: {
  page: Page
  sidebar: Locator
  target: Locator
}): Promise<Locator> {
  await sidebar.hover()
  await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
  await target.click({ button: 'right' })

  const menu = page.locator('.workspace-project-context-menu')
  await expect(menu).toBeVisible()
  await movePointerIntoMenuOutsideSidebar(page, menu)
  await page.waitForTimeout(520)
  await expect(menu).toBeVisible()
  await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
  return menu
}

async function attachSidebarScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  await testInfo.attach('sidebar-context-menu-holds-peek-open', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
}

test.describe('Primary Sidebar Context Menu', () => {
  test('keeps the collapsed sidebar revealed while its portal menu is active', async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: workspaceId,
        workspaces: [
          {
            id: workspaceId,
            name: 'Sidebar menu hold',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                agentId,
                'Sidebar menu agent',
                0,
                'Keep sidebar visible for portal interactions',
                '2026-07-11T10:00:00.000Z',
              ),
            ],
            spaces: [
              {
                id: spaceId,
                name: 'Sidebar menu space',
                directoryPath: testWorkspacePath,
                labelColor: 'blue',
                nodeIds: [agentId],
              },
            ],
            activeSpaceId: spaceId,
          },
        ],
      })

      const sidebar = window.locator('.workspace-sidebar')
      await window.locator('[data-testid="workspace-sidebar-pin"]').click()
      await window.mouse.move(700, 400)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)

      const projectMenu = await openMenuFromPeek({
        page: window,
        sidebar,
        target: window.locator(`[data-testid="workspace-item-${workspaceId}"]`),
      })
      await attachSidebarScreenshot(window, testInfo)
      await window.keyboard.press('Escape')
      await expect(projectMenu).toHaveCount(0)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)

      const spaceMenu = await openMenuFromPeek({
        page: window,
        sidebar,
        target: window.locator(`[data-testid="workspace-space-item-${workspaceId}-${spaceId}"]`),
      })
      await window.mouse.click(700, 400)
      await expect(spaceMenu).toHaveCount(0)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)

      const agentMenu = await openMenuFromPeek({
        page: window,
        sidebar,
        target: window.locator(`[data-testid="workspace-agent-item-${workspaceId}-${agentId}"]`),
      })
      await sidebar.hover()
      await window.keyboard.press('Escape')
      await expect(agentMenu).toHaveCount(0)
      await window.waitForTimeout(520)
      await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)

      await window.mouse.move(700, 400)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
    } finally {
      await electronApp.close()
    }
  })
})
