import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

const projectId = 'sidebar-visibility-project'
const spaceId = 'sidebar-visibility-space'
const agentId = 'sidebar-visibility-agent'

async function seed(page: Page, theme: 'pixel' | 'pixel-light') {
  await seedWorkspaceState(page, {
    activeWorkspaceId: projectId,
    settings: { uiTheme: theme, language: 'en' },
    workspaces: [
      {
        id: projectId,
        name: 'OpenCove',
        path: testWorkspacePath,
        nodes: [
          createRailAgent(
            agentId,
            'Review the workspace',
            100,
            'Review UI',
            '2026-09-19T10:00:00.000Z',
          ),
        ],
        spaces: [
          {
            id: spaceId,
            name: 'ui/chrome',
            directoryPath: testWorkspacePath,
            labelColor: 'blue',
            nodeIds: [agentId],
          },
        ],
      },
    ],
  })
}

for (const theme of ['pixel', 'pixel-light'] as const) {
  test(`Sidebar view mode cycles restore hidden items in ${theme}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()
    try {
      await seed(window, theme)
      const agent = window.getByTestId(`workspace-agent-item-${projectId}-${agentId}`)
      const space = window.getByTestId(`workspace-space-item-${projectId}-${spaceId}`)
      const more = window.getByTestId(`workspace-agent-more-${projectId}-${agentId}`)
      await window.mouse.move(900, 500)
      await expect(more).toHaveCSS('opacity', '0')
      await agent.hover()
      await expect(more).toHaveCSS('opacity', '1')
      await more.click()
      await window.getByTestId('workspace-sidebar-visibility-action').click()
      await expect(agent).toHaveCount(0)
      await expect(space).toBeVisible()
      const mode = window.getByTestId('workspace-sidebar-view-mode')
      await expect(mode).toHaveAttribute('data-mode', 'normal')
      await mode.click()
      await expect(mode).toHaveAttribute('data-mode', 'all')
      await expect(agent).toBeVisible()
      await expect(
        window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`),
      ).toBeVisible()
      await testInfo.attach(`sidebar-hidden-items-${theme}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await expect
        .poll(async () =>
          window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            return raw ? JSON.parse(raw).settings?.sidebarView?.mode : null
          }),
        )
        .toBe('all')
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(
        window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`),
      ).toBeVisible()
      await window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`).click()
      await expect(window.locator('.workspace-sidebar__feedback')).toContainText(
        'visible in Sidebar',
      )
      await expect(agent).toBeVisible()
      await space.click({ button: 'right' })
      await window.getByTestId('workspace-sidebar-visibility-action').click()
      await expect(space).toBeVisible()
      await expect(
        window.getByTestId(`workspace-space-restore-${projectId}-${spaceId}`),
      ).toBeVisible()
      await mode.click()
      await expect(mode).toHaveAttribute('data-mode', 'focus')
      await expect(space).toHaveCount(0)
      await mode.click()
      await expect(mode).toHaveAttribute('data-mode', 'normal')
      await expect(space).toHaveCount(0)
      await mode.click()
      await expect(mode).toHaveAttribute('data-mode', 'all')
      await expect(agent).toBeVisible()
      await expect(
        window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`),
      ).toHaveCount(0)
      await window.getByTestId(`workspace-space-restore-${projectId}-${spaceId}`).click()
      await expect(more).toBeAttached()
    } finally {
      await electronApp.close()
    }
  })
}

test('Sidebar view mode and hidden restoration remain usable in the mobile drawer', async ({
  browserName: _browserName,
}, testInfo) => {
  const { electronApp, window } = await launchApp()
  try {
    await seed(window, 'pixel')
    await window.setViewportSize({ width: 390, height: 800 })
    await window.getByTestId('primary-sidebar-open').click()
    await expect(window.getByTestId('primary-sidebar-drawer')).toBeVisible()
    const more = window.getByTestId(`workspace-agent-more-${projectId}-${agentId}`)
    await expect(more).toHaveCSS('opacity', '1')
    await expect(more).toHaveCSS('height', '44px')
    await more.click()
    await window.getByTestId('workspace-sidebar-visibility-action').click()
    const mode = window.getByTestId('workspace-sidebar-view-mode')
    await expect(mode).toHaveAttribute('data-mode', 'normal')
    await mode.click()
    await expect(mode).toHaveAttribute('data-mode', 'all')
    await expect(
      window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`),
    ).toBeVisible()
    await testInfo.attach('sidebar-mobile-view-mode', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await expect(window.getByTestId('primary-sidebar-drawer')).toBeVisible()
    await window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`).click()
    await expect(window.locator('.workspace-sidebar__feedback')).toContainText('visible in Sidebar')
  } finally {
    await electronApp.close()
  }
})
