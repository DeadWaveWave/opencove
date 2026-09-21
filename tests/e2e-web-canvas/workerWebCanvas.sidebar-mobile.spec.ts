import { expect, test, type Page } from '@playwright/test'
import { buildAppState, createWorkspaceDir, openAuthedCanvas, writeAppState } from './helpers'

test.use({ hasTouch: true })

async function readCanvasGeometry(page: Page) {
  return page.locator('.workspace-canvas .react-flow').evaluate(element => {
    const rect = element.getBoundingClientRect()
    const viewport = element.querySelector('.react-flow__viewport')
    return { x: rect.x, width: rect.width, transform: (viewport as HTMLElement)?.style.transform }
  })
}

for (const theme of ['pixel', 'pixel-light']) {
  test(`mobile navigation overlays the canvas in ${theme}`, async ({ page }, testInfo) => {
    const workspacePath = await createWorkspaceDir(`sidebar-${theme}`)
    const state = buildAppState({
      workspaceId: 'mobile-project',
      workspaceName: 'OpenCove',
      workspacePath,
      spaces: [
        {
          id: 'mobile-space',
          name: 'ui/chrome',
          directoryPath: workspacePath,
          nodeIds: ['mobile-agent'],
          rect: { x: 600, y: 200, width: 900, height: 700 },
        },
      ],
      settings: { uiTheme: theme, isPrimarySidebarCollapsed: false },
    })
    const firstProject = state.workspaces[0] as Record<string, unknown>
    firstProject.nodes = [
      {
        id: 'mobile-agent',
        title: 'Refine navigation',
        kind: 'agent',
        position: { x: 720, y: 320 },
        width: 520,
        height: 360,
        status: 'stopped',
        labelColorOverride: 'orange',
        agent: {
          provider: 'codex',
          prompt: 'Refine navigation',
          model: null,
          effectiveModel: null,
          launchMode: 'new',
          resumeSessionId: null,
          executionDirectory: workspacePath,
          expectedDirectory: workspacePath,
          directoryMode: 'workspace',
          customDirectory: null,
          shouldCreateDirectory: false,
        },
      },
    ]
    ;(firstProject.spaces as Array<Record<string, unknown>>)[0].labelColor = 'green'
    state.workspaces.push({
      ...firstProject,
      id: 'mobile-second',
      name: 'Design system',
      nodes: [],
      spaces: [],
      activeSpaceId: null,
    })
    await writeAppState(page.request, state)
    await page.setViewportSize({ width: 390, height: 844 })
    await openAuthedCanvas(page)
    const open = page.getByTestId('primary-sidebar-open')
    const drawer = page.getByTestId('primary-sidebar-drawer')
    await expect(open).toBeVisible()
    await expect(page.getByTestId('workspace-sidebar')).toHaveCount(0)
    const initialGeometry = await readCanvasGeometry(page)
    expect(initialGeometry.width).toBe(390)
    await open.click()
    await expect(drawer).toBeVisible()
    await expect(page.locator('.workspace-main')).toHaveAttribute('inert', '')
    expect(await readCanvasGeometry(page)).toEqual(initialGeometry)
    await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(0)
    const rect = await drawer.boundingBox()
    expect(rect?.width).toBe(342)
    expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true)
    const projectButton = page.locator('.workspace-item').filter({ hasText: 'Design system' })
    await projectButton.click()
    await expect(drawer).toBeVisible()
    await expect(page.locator('.workspace-item--active')).toContainText('Design system')
    await page.locator('.workspace-item').filter({ hasText: 'OpenCove' }).click()
    await expect(page.locator('.workspace-item--active')).toContainText('OpenCove')
    await expect(drawer.locator('[data-agent-provider="codex"]')).toBeVisible()
    const rowHeights = await drawer
      .locator('.workspace-space-item, .workspace-agent-item')
      .evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))
    for (const height of rowHeights) {
      expect(height).toBeGreaterThanOrEqual(44)
    }
    await testInfo.attach(`sidebar-${theme}-mobile`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(open).toBeFocused()
    await open.click()
    const settings = drawer.getByTestId('app-header-settings')
    await expect(settings).toBeVisible()
    expect((await settings.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await settings.click()
    await expect(drawer).toHaveCount(0)
    await expect(page.getByTestId('settings-panel-close')).toBeFocused()
    await expect(page.locator('.app-shell')).toHaveJSProperty('inert', false)
    await expect(page.locator('.workspace-main')).toHaveAttribute('inert', '')
    expect(await readCanvasGeometry(page)).toEqual(initialGeometry)
    await page.getByTestId('settings-panel-close').click()
    await expect(open).toBeFocused()
    await expect(page.locator('.workspace-main')).not.toHaveAttribute('inert', '')
    await open.click()
    const beforeDismiss = await readCanvasGeometry(page)
    await page.mouse.click(374, 500)
    await expect(drawer).toHaveCount(0)
    expect(await readCanvasGeometry(page)).toEqual(beforeDismiss)
    await expect(page.locator('.workspace-main')).not.toHaveAttribute('inert', '')
    await open.click()
    await page.getByTestId('workspace-agent-item-mobile-project-mobile-agent').click()
    await expect(drawer).toHaveCount(0)
    await expect(open).toBeFocused()
    expect(
      await page.evaluate(() =>
        document.activeElement?.matches('input, textarea, [contenteditable="true"]'),
      ),
    ).toBe(false)
    await expect
      .poll(async () => (await readCanvasGeometry(page)).transform)
      .not.toBe(initialGeometry.transform)
    await open.click()
    await page.getByTestId('workspace-space-item-mobile-project-mobile-space').click()
    await expect(drawer).toHaveCount(0)
    await open.click()
    const more = page.getByTestId('workspace-project-more-mobile-project')
    await more.focus()
    await more.press('Enter')
    const projectMenu = page.locator('.workspace-project-context-menu')
    await expect(projectMenu).toBeVisible()
    await expect
      .poll(() => projectMenu.evaluate(element => element.contains(document.activeElement)))
      .toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('.workspace-project-context-menu')).toHaveCount(0)
    await expect(drawer).toBeVisible()
    await expect(more).toBeFocused()
    await page.getByTestId('workspace-sidebar-add-project').click()
    await expect(drawer).toHaveCount(0)
    const createProject = page.getByTestId('workspace-project-create-window')
    await expect(createProject).toBeVisible()
    const projectInput = createProject.locator('input').first()
    await projectInput.click()
    await expect(projectInput).toBeFocused()
    await page.getByTestId('workspace-project-create-cancel').click()
    await open.click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(drawer).toHaveCount(0)
    await expect(page.locator('.workspace-sidebar--docked')).toBeVisible()
    await expect
      .poll(async () => (await page.getByTestId('workspace-sidebar').boundingBox())?.width)
      .toBe(312)
    await expect(page.getByTestId('primary-sidebar-open')).toHaveCount(0)
    await testInfo.attach(`sidebar-${theme}-desktop`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  })
}
