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
  test('keeps project icons stable while the project navigation collapses and peeks', async () => {
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
      expect(Math.abs(dockedRail.width - 52)).toBeLessThanOrEqual(1)
      expect(
        Math.abs(dockedProject.x + dockedProject.width / 2 - dockedRail.x - dockedRail.width / 2),
      ).toBeLessThanOrEqual(1)
      expect(dockedNavigation.x).toBeGreaterThanOrEqual(dockedRail.x + dockedRail.width - 1)
      expect(spaceRect.y + spaceRect.height).toBeLessThanOrEqual(agentRect.y + 1)
      expect(agentRect.x).toBeGreaterThan(spaceRect.x)
      expect(agentRect.x + agentRect.width).toBeLessThanOrEqual(
        dockedNavigation.x + dockedNavigation.width,
      )
      expect(agentRect.height).toBeGreaterThanOrEqual(28)

      await window.getByTestId('workspace-sidebar-pin').click()
      await window.mouse.move(700, 80)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await expect(navigation).toHaveCount(0)
      await expect(window.locator('.workspace-space-item')).toHaveCount(0)
      await expect(window.locator('.workspace-agent-item')).toHaveCount(0)
      await expect.poll(async () => (await rect(sidebar)).width).toBeCloseTo(52, 0)
      const collapsedProject = await rect(project)
      expect(Math.abs(collapsedProject.x - dockedProject.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(collapsedProject.y - dockedProject.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(collapsedProject.width - dockedProject.width)).toBeLessThanOrEqual(1)

      const canvasBeforePeek = await rect(window.locator('.workspace-canvas'))
      await project.hover()
      await expect(sidebar).toHaveClass(/workspace-sidebar--peek/)
      await expect(navigation).toBeVisible()
      await expect(agent).toBeVisible()
      const canvasAfterPeek = await rect(window.locator('.workspace-canvas'))
      expect(canvasAfterPeek).toEqual(canvasBeforePeek)
      const peekProject = await rect(project)
      expect(Math.abs(peekProject.x - collapsedProject.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(peekProject.y - collapsedProject.y)).toBeLessThanOrEqual(1)
    } finally {
      await electronApp.close()
    }
  })
})
