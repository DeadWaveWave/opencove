import { expect, test, type Locator } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

async function rect(locator: Locator) {
  const value = await locator.boundingBox()
  if (!value) {
    throw new Error('Sidebar geometry target is not visible')
  }
  return value
}

test.describe('Workspace Canvas - Sidebar Row Geometry', () => {
  test('preserves project and navigation geometry after hiding and reopening the sidebar', async () => {
    const { electronApp, window } = await launchApp()
    const workspaceId = 'workspace-sidebar-spacing'
    const spaceId = 'space-sidebar-spacing'
    const agentId = 'agent-sidebar-spacing'

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: workspaceId,
        workspaces: [
          {
            id: workspaceId,
            name: 'Sidebar spacing',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                agentId,
                'Sidebar spacing agent',
                0,
                'Measure sidebar spacing',
                '2026-03-29T10:00:00.000Z',
              ),
            ],
            spaces: [
              {
                id: spaceId,
                name: 'Spacing',
                directoryPath: testWorkspacePath,
                labelColor: 'blue',
                nodeIds: [agentId],
              },
            ],
            activeSpaceId: spaceId,
          },
        ],
      })

      const sidebar = window.getByTestId('workspace-sidebar')
      const rail = window.getByTestId('workspace-project-rail')
      const project = window.getByTestId(`workspace-item-${workspaceId}`)
      const space = window.getByTestId(`workspace-space-item-${workspaceId}-${spaceId}`)
      const agent = window.getByTestId(`workspace-agent-item-${workspaceId}-${agentId}`)
      const navigation = window.getByTestId('workspace-sidebar-navigation')
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      await expect(space).toBeVisible()
      await expect(agent).toBeVisible()

      const dockedProject = await rect(project)
      const dockedRail = await rect(rail)
      const dockedNavigation = await rect(navigation)
      const spaceRect = await rect(space)
      const agentRect = await rect(agent)
      expect(Math.abs(dockedRail.width - 72)).toBeLessThanOrEqual(1)
      expect(
        Math.abs(dockedProject.x + dockedProject.width / 2 - dockedRail.x - dockedRail.width / 2),
      ).toBeLessThanOrEqual(1)
      expect(dockedNavigation.x).toBeGreaterThanOrEqual(dockedRail.x + dockedRail.width - 1)
      expect(spaceRect.y + spaceRect.height).toBeLessThanOrEqual(agentRect.y + 1)
      // Agents sit inside their Space card, below its mini map and name.
      const cardRect = await rect(window.locator('.workspace-space-group--space').first())
      expect(agentRect.x).toBeGreaterThanOrEqual(cardRect.x)
      expect(agentRect.x + agentRect.width).toBeLessThanOrEqual(cardRect.x + cardRect.width)
      expect(agentRect.x + agentRect.width).toBeLessThanOrEqual(
        dockedNavigation.x + dockedNavigation.width,
      )
      expect(agentRect.height).toBeGreaterThanOrEqual(28)
      // One line at the theme's row height, like a Space row (only touch pointers get 44px), and the
      // whole row selects the agent, not just its text.
      const rowHeight = await sidebar.evaluate(element =>
        parseFloat(getComputedStyle(element).getPropertyValue('--cove-sidebar-row-height')),
      )
      const row = await rect(window.locator('.workspace-agent-item--sidebar').first())
      expect(Math.abs(row.height - (rowHeight + 2))).toBeLessThanOrEqual(1)
      expect(row.height - agentRect.height).toBeLessThanOrEqual(2)

      // Pointing at the current project keeps its full edge bar.
      await window.emulateMedia({ reducedMotion: 'reduce' })
      await project.hover()
      await expect
        .poll(() =>
          project.evaluate(
            element =>
              getComputedStyle(element.closest('.workspace-project-rail__item')!, '::before')
                .height,
          ),
        )
        .toBe('22px')
      await window.emulateMedia({ reducedMotion: 'no-preference' })

      await window.getByTestId('app-header-sidebar-toggle').click()
      await window.mouse.move(700, 80)
      await expect(sidebar).toHaveClass(/workspace-sidebar--hidden/)
      await expect(sidebar).toBeHidden()
      await expect(navigation).toBeHidden()
      await window.getByTestId('app-header-sidebar-toggle').click()
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      await expect(navigation).toBeVisible()
      await expect(agent).toBeVisible()
      await expect.poll(() => rect(navigation)).toEqual(dockedNavigation)
      expect(await rect(project)).toEqual(dockedProject)
      expect(await rect(rail)).toEqual(dockedRail)
      // Agent recovery updates status text and row heights independently of sidebar layout.
      expect(await rect(space)).toMatchObject({ x: spaceRect.x, width: spaceRect.width })
      expect(await rect(agent)).toMatchObject({ x: agentRect.x, width: agentRect.width })
    } finally {
      await electronApp.close()
    }
  })
})
