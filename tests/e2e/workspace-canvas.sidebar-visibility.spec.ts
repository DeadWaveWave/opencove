import { expect, test, type Page } from '@playwright/test'
import {
  launchApp,
  seedWorkspaceState,
  selectCoveOption,
  testWorkspacePath,
} from './workspace-canvas.helpers'
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
  test(`Sidebar filters restore hidden items with compact dropdowns in ${theme}`, async ({
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
      await window.getByTestId('workspace-sidebar-filter').click()
      const filters = window.getByTestId('workspace-sidebar-filters')
      await expect(filters.getByRole('checkbox')).toHaveCount(0)
      await expect(filters.locator('.cove-select__trigger')).toHaveCount(3)
      await selectCoveOption(window, 'sidebar-filter-visibility', 'hidden')
      await expect(agent).toBeVisible()
      await expect(
        window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`),
      ).toBeVisible()
      await testInfo.attach(`sidebar-hidden-filter-${theme}`, {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
      await expect
        .poll(async () =>
          window.evaluate(async () => {
            const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
            return raw ? JSON.parse(raw).settings?.sidebarView?.filters?.visibility : null
          }),
        )
        .toBe('hidden')
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(
        window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`),
      ).toBeVisible()
      await window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`).click()
      await expect(agent).toHaveCount(0)
      await expect(window.locator('.workspace-sidebar__feedback')).toContainText(
        'visible in Sidebar',
      )
      await window.getByTestId('workspace-sidebar-filter').click()
      await window.getByRole('button', { name: 'Reset filters', exact: true }).click()
      await window.keyboard.press('Escape')
      await expect(agent).toBeVisible()
      await space.click({ button: 'right' })
      await window.getByTestId('workspace-sidebar-visibility-action').click()
      await expect(space).toHaveCount(0)
      await window.getByTestId('workspace-sidebar-filter').click()
      await selectCoveOption(window, 'sidebar-filter-visibility', 'all')
      await window.keyboard.press('Escape')
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

test('Sidebar dropdowns and hidden restoration remain usable in the mobile drawer', async ({
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
    await window.getByTestId('workspace-sidebar-filter').click()
    await window.getByTestId('sidebar-filter-visibility-trigger').click()
    const option = window.getByRole('option', { name: 'Hidden only', exact: true })
    await option.focus()
    await expect(option).toBeFocused()
    await option.click()
    await expect(window.getByTestId('workspace-sidebar-filters')).toBeVisible()
    await testInfo.attach('sidebar-mobile-filters', {
      body: await window.screenshot(),
      contentType: 'image/png',
    })
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('primary-sidebar-drawer')).toBeVisible()
    await window.getByTestId(`workspace-agent-restore-${projectId}-${agentId}`).click()
    await expect(window.locator('.workspace-sidebar__feedback')).toContainText('visible in Sidebar')
  } finally {
    await electronApp.close()
  }
})
