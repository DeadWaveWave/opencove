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

async function openMenuFromPeek({
  page,
  sidebar,
  target,
}: {
  page: Page
  sidebar: Locator
  target: Locator
}): Promise<Locator> {
  await page.getByTestId(`workspace-item-${workspaceId}`).hover()
  await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
  await target.click({ button: 'right' })

  const menu = page.locator('.workspace-project-context-menu')
  await expect(menu).toBeVisible()
  await movePointerOutsideSidebar(page, menu)
  await page.waitForTimeout(520)
  await expect(menu).toBeVisible()
  await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
  return menu
}

async function clickMenuActionAtNavigationPosition({
  page,
  action,
  insideNavigation,
}: {
  page: Page
  action: Locator
  insideNavigation: boolean
}): Promise<void> {
  const [actionRect, navigationRect] = await Promise.all([
    action.evaluate(element => element.getBoundingClientRect().toJSON()),
    page
      .getByTestId('workspace-sidebar-navigation')
      .evaluate(element => element.getBoundingClientRect().toJSON()),
  ])
  const left = insideNavigation
    ? Math.max(actionRect.left, navigationRect.left)
    : Math.max(actionRect.left, navigationRect.right)
  const right = insideNavigation
    ? Math.min(actionRect.right, navigationRect.right)
    : actionRect.right
  const x = (left + right) / 2
  const y = actionRect.top + actionRect.height / 2
  expect(right - left).toBeGreaterThan(8)
  expect(y).toBeGreaterThan(navigationRect.top)
  expect(y).toBeLessThan(navigationRect.bottom)

  // A real press lasts across event-loop turns. Do not repair hover after the
  // portal disappears: the pointer must remain at this exact navigation point.
  await action.click({
    position: { x: x - actionRect.left, y: y - actionRect.top },
    delay: 80,
  })
}

async function movePointerIntoNavigationBlankArea(page: Page): Promise<void> {
  const treeRect = await page
    .locator('.workspace-sidebar__tree-scroll')
    .evaluate(element => element.getBoundingClientRect().toJSON())
  await page.mouse.move(treeRect.left + treeRect.width / 2, treeRect.bottom - 24)
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

      await window.getByTestId(`workspace-item-${workspaceId}`).hover()
      await window.getByTestId(`workspace-project-more-${workspaceId}`).click()
      await expect(window.locator('.workspace-project-context-menu')).toBeVisible()
      await window.keyboard.press('Escape')
      await window.mouse.move(700, 400)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)

      const verifyNavigationHover = async (kind: 'space' | 'agent', id: string): Promise<void> => {
        const target = window.getByTestId(`workspace-${kind}-item-${workspaceId}-${id}`)
        const pinAction = window.getByTestId(`workspace-${kind}-context-pin-${id}`)

        await test.step(`${kind}: menu action leaves the pointer over the navigation tree`, async () => {
          const menu = await openMenuFromPeek({ page: window, sidebar, target })
          await clickMenuActionAtNavigationPosition({
            page: window,
            action: pinAction,
            insideNavigation: true,
          })
          await expect(menu).toHaveCount(0)
          await window.waitForTimeout(520)
          await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
          await expect(window.getByTestId('workspace-sidebar-navigation')).toBeVisible()

          await movePointerIntoNavigationBlankArea(window)
          await window.waitForTimeout(520)
          await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
          await window.mouse.move(700, 400)
          await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
        })

        await test.step(`${kind}: returning directly to the tree after an outside menu action keeps it open`, async () => {
          const menu = await openMenuFromPeek({ page: window, sidebar, target })
          await clickMenuActionAtNavigationPosition({
            page: window,
            action: pinAction,
            insideNavigation: false,
          })
          await expect(menu).toHaveCount(0)
          await movePointerIntoNavigationBlankArea(window)
          await window.waitForTimeout(520)
          await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
          await expect(window.getByTestId('workspace-sidebar-navigation')).toBeVisible()

          await window.mouse.move(700, 400)
          await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
        })
      }
      await verifyNavigationHover('space', spaceId)
      await verifyNavigationHover('agent', agentId)
    } finally {
      await electronApp.close()
    }
  })
})
