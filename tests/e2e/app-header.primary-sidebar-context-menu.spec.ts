import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

const workspaceId = 'workspace-sidebar-context-menu'
const spaceId = 'space-sidebar-context-menu'
const agentId = 'agent-sidebar-context-menu'

async function movePointerOutsideSidebar(page: Page, menu: Locator): Promise<void> {
  const [menuRect, sidebarRect] = await Promise.all([
    menu.evaluate(element => element.getBoundingClientRect().toJSON()),
    page
      .locator('.workspace-sidebar')
      .evaluate(element => element.getBoundingClientRect().toJSON()),
  ])
  const x = Math.max(sidebarRect.right + 12, menuRect.right + 12)
  const y = menuRect.top + Math.min(menuRect.height / 2, 40)
  await page.mouse.move(x, y)
}

async function openSidebarMenu({
  page,
  sidebar,
  target,
}: {
  page: Page
  sidebar: Locator
  target: Locator
}): Promise<Locator> {
  await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
  await target.click({ button: 'right' })

  const menu = page.locator('.workspace-project-context-menu')
  await expect(menu).toBeVisible()
  await movePointerOutsideSidebar(page, menu)
  await expect(menu).toBeVisible()
  await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
  return menu
}

async function attachSidebarScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  await testInfo.attach('sidebar-context-menu-keeps-navigation-visible', {
    body: await page.screenshot(),
    contentType: 'image/png',
  })
}

test.describe('Primary Sidebar Context Menu', () => {
  test('keeps docked navigation visible through portal menus and their actions', async ({
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
      // Reopen through the header before interacting with sidebar-only controls.
      await window.getByTestId('app-header-sidebar-toggle').click()
      await expect(sidebar).toBeHidden()
      await window.getByTestId('app-header-sidebar-toggle').click()
      await expect(sidebar).toBeVisible()

      const projectMenu = await openSidebarMenu({
        page: window,
        sidebar,
        target: window.locator(`[data-testid="workspace-item-${workspaceId}"]`),
      })
      await attachSidebarScreenshot(window, testInfo)
      await window.keyboard.press('Escape')
      await expect(projectMenu).toHaveCount(0)
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)

      await window.getByTestId(`workspace-item-${workspaceId}`).hover()
      await window.getByTestId(`workspace-project-more-${workspaceId}`).click()
      await expect(window.locator('.workspace-project-context-menu')).toBeVisible()
      await window.keyboard.press('Escape')
      await window.mouse.move(700, 400)
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)

      const verifyPortalAction = async (kind: 'space' | 'agent', id: string): Promise<void> => {
        await test.step(`${kind}: pinning from its portal keeps navigation available`, async () => {
          const target = window.getByTestId(`workspace-${kind}-item-${workspaceId}-${id}`)
          const menu = await openSidebarMenu({ page: window, sidebar, target })
          const pinAction = window.getByTestId(`workspace-${kind}-context-pin-${id}`)
          await pinAction.click()
          await expect(menu).toHaveCount(0)
          await window.mouse.move(700, 400)
          await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
          await expect(window.getByTestId('workspace-sidebar-navigation')).toBeVisible()
        })
      }
      await verifyPortalAction('space', spaceId)
      await verifyPortalAction('agent', agentId)
    } finally {
      await electronApp.close()
    }
  })
})
