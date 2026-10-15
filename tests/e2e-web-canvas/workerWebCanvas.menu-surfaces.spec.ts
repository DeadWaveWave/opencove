import { expect, test, type Locator, type Page } from '@playwright/test'
import { buildAppState, createWorkspaceDir, openAuthedCanvas, writeAppState } from './helpers'

test.use({ hasTouch: true })

async function expectFits(surface: Locator) {
  const geometry = await surface.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(0)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
}

// New Task places a task window where the menu opened; its editor is the canvas's task dialog.
async function createTaskAndOpenEditor(page: Page) {
  const taskNodes = page.locator('.react-flow__node:has(.task-node)')
  const readIds = () =>
    taskNodes.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id') ?? ''))
  const before = await readIds()
  await page.getByTestId('workspace-context-new-task').click()
  await expect(taskNodes).toHaveCount(before.length + 1)
  const created = (await readIds()).find(id => !before.includes(id))
  const node = page.locator(`.react-flow__node[data-id="${created}"]`)
  await node.getByTestId('task-node-more').click()
  await page.getByTestId('task-node-open-editor').click()
}

for (const theme of ['pixel', 'pixel-light']) {
  test(`menus and dialogs keep their context on desktop and mobile in ${theme}`, async ({
    page,
  }, testInfo) => {
    const workspacePath = await createWorkspaceDir(`surfaces-${theme}`)
    await writeAppState(
      page.request,
      buildAppState({
        workspaceId: 'surfaces',
        workspaceName: 'OpenCove',
        workspacePath,
        spaces: [],
        settings: { uiTheme: theme, isPrimarySidebarCollapsed: false },
      }),
    )
    await page.setViewportSize({ width: 1280, height: 800 })
    await openAuthedCanvas(page)
    await expect(page.locator('.workspace-canvas')).toBeVisible()
    await page.mouse.click(850, 320, { button: 'right' })
    const canvasMenu = page.locator('.workspace-canvas-context-menu').first()
    await expect(canvasMenu).toBeVisible()
    await expectFits(canvasMenu)
    expect(await canvasMenu.evaluate(element => getComputedStyle(element).borderRadius)).toBe('8px')
    await expect(
      page.getByTestId('workspace-context-create-space').locator('.lucide-scan'),
    ).toBeVisible()
    await testInfo.attach(`menu-${theme}-desktop`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    const task = page.getByTestId('workspace-task-editor')
    await createTaskAndOpenEditor(page)
    await expect(task).toHaveAttribute('role', 'dialog')
    await expectFits(task)
    await page.getByTestId('workspace-task-editor-requirement').fill('Unify workspace surfaces')
    await testInfo.attach(`task-${theme}-desktop`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(task).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    const open = page.getByTestId('primary-sidebar-open')
    await open.click()
    const more = page.getByTestId('workspace-project-more-surfaces')
    await more.click()
    const projectMenu = page.locator('.workspace-project-context-menu')
    await expect(projectMenu).toHaveClass(/cove-menu-sheet/)
    await expectFits(projectMenu)
    const heights = await projectMenu
      .locator('button')
      .evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height))
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(43.99)
    await page.getByTestId('workspace-project-context-menu-rename').click()
    const name = projectMenu.locator('input')
    await expect(name).toBeFocused()
    await expect(page.locator('.workspace-main')).toHaveAttribute('inert', '')
    await testInfo.attach(`menu-${theme}-mobile`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(projectMenu).toBeVisible()
    await expect(name).toHaveCount(0)
    await expect(projectMenu.locator('.cove-menu-sheet__title')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(projectMenu).toHaveCount(0)
    await expect(page.getByTestId('primary-sidebar-drawer')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.workspace-main')).not.toHaveAttribute('inert', '')

    await page.mouse.click(210, 310, { button: 'right' })
    const providerToggle = page.getByTestId('workspace-context-run-agent-provider-toggle')
    expect(
      await providerToggle.evaluate(element => element.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(43.99)
    await providerToggle.click()
    const submenu = page.getByTestId('workspace-context-run-agent-provider-menu')
    await expect(submenu).toHaveClass(/cove-menu-sheet/)
    await expectFits(submenu)
    await submenu.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(submenu).toHaveCount(0)
    await createTaskAndOpenEditor(page)
    await expect(task).toBeVisible()
    await page.setViewportSize({ width: 320, height: 700 })
    await expectFits(task)
    await page
      .getByTestId('workspace-task-editor-requirement')
      .fill('Keep the mobile canvas usable')
    await testInfo.attach(`task-${theme}-mobile`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await open.click()
    await more.click()
    await page.getByTestId('workspace-project-remove-surfaces').click()
    const confirmation = page.getByTestId('workspace-project-delete-confirmation')
    await expect(confirmation).toHaveAttribute('role', 'alertdialog')
    await expectFits(confirmation)
    await expect(page.getByTestId('workspace-project-delete-cancel')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirmation).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.workspace-main')).not.toHaveAttribute('inert', '')
  })
}
