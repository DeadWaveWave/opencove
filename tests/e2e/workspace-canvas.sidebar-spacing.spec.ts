import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

type SidebarRowGeometry = {
  sidebarWidth: number
  pinButtonCenter: number
  projectGroupLeftInset: number
  projectGroupRightInset: number
  projectGroupCenter: number
  projectContentTopInset: number
  projectIconCenter: number
  projectToggleCenter: number
  projectToggleIconCenter: number
  spaceSurfaceProjectLeftGap: number
  spaceSurfaceProjectRightGap: number
  spaceBranchLeftInset: number
  spaceBranchRightInset: number
  spaceBranchGap: number
  spaceBranchTopGap: number
  spaceBranchBottomGap: number
  spaceSurfaceLeftInset: number
  spaceSurfaceRightInset: number
  spaceSurfaceGutterDelta: number
  spaceSurfaceWidth: number
  spaceSurfaceHeight: number
  spaceSurfaceCenter: number
  spaceNameLeft: number
  spaceToggleCenter: number
  spaceToggleIconCenter: number
  spaceRailIconCenter: number
  agentSurfaceLeftInset: number
  agentSurfaceRightInset: number
  agentSurfaceGutterDelta: number
  agentSurfaceWidth: number
  agentSurfaceHeight: number
  agentSurfaceCenter: number
  agentSurfaceProjectLeftGap: number
  agentSurfaceProjectRightGap: number
  agentProviderCenter: number
}

const expectDistanceWithin = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

const readSidebarRowGeometry = async (
  page: Page,
  workspaceId: string,
  spaceId: string,
  agentId: string,
): Promise<SidebarRowGeometry> => {
  return await page.evaluate(
    ({ activeWorkspaceId, activeSpaceId, activeAgentId }) => {
      const sidebar = document.querySelector('.workspace-sidebar')
      const pinButton = document.querySelector('[data-testid="workspace-sidebar-pin"]')
      const projectItem = document.querySelector(
        `[data-testid="workspace-item-${activeWorkspaceId}"]`,
      )
      const projectGroup = projectItem?.closest('.workspace-item-group')
      const projectIcon = projectItem?.querySelector('.workspace-item__folder-icon')
      const projectToggle = projectItem?.querySelector('.workspace-item__tree-toggle')
      const projectToggleIcon = projectToggle?.querySelector('.workspace-tree-triangle')
      const spaceItem = document.querySelector(
        `[data-testid="workspace-space-item-${activeWorkspaceId}-${activeSpaceId}"]`,
      )
      const spaceGroup = spaceItem?.closest('.workspace-space-group')
      const spaceName = spaceItem?.querySelector('.workspace-space-item__name')
      const spaceToggle = spaceItem?.querySelector('.workspace-space-item__toggle')
      const spaceToggleIcon = spaceToggle?.querySelector('.workspace-tree-triangle')
      const spaceRailIcon = spaceItem?.querySelector('.workspace-space-item__rail-icon')
      const agentItem = document.querySelector(
        `[data-testid="workspace-agent-item-${activeWorkspaceId}-${activeAgentId}"]`,
      )
      const agentProvider = agentItem?.querySelector('.workspace-agent-item__provider')

      if (
        !(sidebar instanceof HTMLElement) ||
        !(pinButton instanceof HTMLElement) ||
        !(projectItem instanceof HTMLElement) ||
        !(projectGroup instanceof HTMLElement) ||
        !(projectIcon instanceof SVGElement) ||
        !(projectToggle instanceof HTMLElement) ||
        !(projectToggleIcon instanceof HTMLElement) ||
        !(spaceItem instanceof HTMLElement) ||
        !(spaceGroup instanceof HTMLElement) ||
        !(spaceName instanceof HTMLElement) ||
        !(spaceToggle instanceof HTMLElement) ||
        !(spaceToggleIcon instanceof HTMLElement) ||
        !(spaceRailIcon instanceof HTMLElement) ||
        !(agentItem instanceof HTMLElement) ||
        !(agentProvider instanceof HTMLElement)
      ) {
        throw new Error('Sidebar row geometry target not available')
      }

      const round = (value: number) => Number(value.toFixed(3))
      const centerFromSidebarLeft = (element: Element): number => {
        const sidebarRect = sidebar.getBoundingClientRect()
        const rect = element.getBoundingClientRect()
        return round(rect.left + rect.width / 2 - sidebarRect.left)
      }
      const surfaceMetrics = (element: HTMLElement, pseudoElement: '::before') => {
        const sidebarRect = sidebar.getBoundingClientRect()
        const itemRect = element.getBoundingClientRect()
        const surfaceStyle = window.getComputedStyle(element, pseudoElement)
        const surfaceLeft = itemRect.left + Number.parseFloat(surfaceStyle.left)
        const surfaceWidth = Number.parseFloat(surfaceStyle.width)
        const surfaceRight = surfaceLeft + surfaceWidth
        const leftInset = surfaceLeft - sidebarRect.left
        const rightInset = sidebarRect.right - surfaceRight

        return {
          leftInset: round(leftInset),
          rightInset: round(rightInset),
          gutterDelta: round(Math.abs(leftInset - rightInset)),
          width: round(surfaceWidth),
          height: round(Number.parseFloat(surfaceStyle.height)),
          center: round(surfaceLeft + surfaceWidth / 2 - sidebarRect.left),
        }
      }

      const sidebarRect = sidebar.getBoundingClientRect()
      const projectGroupRect = projectGroup.getBoundingClientRect()
      const projectItemRect = projectItem.getBoundingClientRect()
      const spaceRect = spaceItem.getBoundingClientRect()
      const spaceSurface = surfaceMetrics(spaceItem, '::before')
      const agentSurface = surfaceMetrics(agentItem, '::before')
      const spaceGroupRect = spaceGroup.getBoundingClientRect()
      const branchStyle = window.getComputedStyle(spaceGroup, '::before')
      const branchTop = spaceGroupRect.top + Number.parseFloat(branchStyle.top)
      const branchLeft = spaceGroupRect.left + Number.parseFloat(branchStyle.left)
      const branchRight = branchLeft + Number.parseFloat(branchStyle.width)

      return {
        sidebarWidth: round(sidebarRect.width),
        pinButtonCenter: centerFromSidebarLeft(pinButton),
        projectGroupLeftInset: round(projectGroupRect.left - sidebarRect.left),
        projectGroupRightInset: round(sidebarRect.right - projectGroupRect.right),
        projectGroupCenter: round(
          projectGroupRect.left + projectGroupRect.width / 2 - sidebarRect.left,
        ),
        projectContentTopInset: round(projectItemRect.top - projectGroupRect.top),
        projectIconCenter: centerFromSidebarLeft(projectIcon),
        projectToggleCenter: centerFromSidebarLeft(projectToggle),
        projectToggleIconCenter: centerFromSidebarLeft(projectToggleIcon),
        spaceSurfaceProjectLeftGap: round(
          spaceSurface.leftInset - (projectGroupRect.left - sidebarRect.left),
        ),
        spaceSurfaceProjectRightGap: round(
          spaceSurface.rightInset - (sidebarRect.right - projectGroupRect.right),
        ),
        spaceBranchLeftInset: round(branchLeft - sidebarRect.left),
        spaceBranchRightInset: round(branchRight - sidebarRect.left),
        spaceBranchGap: round(spaceSurface.leftInset - (branchRight - sidebarRect.left)),
        spaceBranchTopGap: round(branchTop - spaceRect.bottom),
        spaceBranchBottomGap: round(projectGroupRect.bottom - spaceGroupRect.bottom),
        spaceSurfaceLeftInset: spaceSurface.leftInset,
        spaceSurfaceRightInset: spaceSurface.rightInset,
        spaceSurfaceGutterDelta: spaceSurface.gutterDelta,
        spaceSurfaceWidth: spaceSurface.width,
        spaceSurfaceHeight: spaceSurface.height,
        spaceSurfaceCenter: spaceSurface.center,
        spaceNameLeft: round(spaceName.getBoundingClientRect().left - sidebarRect.left),
        spaceToggleCenter: centerFromSidebarLeft(spaceToggle),
        spaceToggleIconCenter: centerFromSidebarLeft(spaceToggleIcon),
        spaceRailIconCenter: centerFromSidebarLeft(spaceRailIcon),
        agentSurfaceLeftInset: agentSurface.leftInset,
        agentSurfaceRightInset: agentSurface.rightInset,
        agentSurfaceGutterDelta: agentSurface.gutterDelta,
        agentSurfaceWidth: agentSurface.width,
        agentSurfaceHeight: agentSurface.height,
        agentSurfaceCenter: agentSurface.center,
        agentSurfaceProjectLeftGap: round(
          agentSurface.leftInset - (projectGroupRect.left - sidebarRect.left),
        ),
        agentSurfaceProjectRightGap: round(
          agentSurface.rightInset - (sidebarRect.right - projectGroupRect.right),
        ),
        agentProviderCenter: centerFromSidebarLeft(agentProvider),
      }
    },
    { activeWorkspaceId: workspaceId, activeSpaceId: spaceId, activeAgentId: agentId },
  )
}

test.describe('Workspace Canvas - Sidebar Row Geometry', () => {
  test('keeps project, space, and agent geometry balanced in docked and rail modes', async () => {
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
                nodeIds: ['agent-sidebar-spacing'],
              },
            ],
            activeSpaceId: spaceId,
          },
        ],
      })

      const sidebar = window.locator('.workspace-sidebar')
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)

      const docked = await readSidebarRowGeometry(window, workspaceId, spaceId, agentId)

      await window.locator('[data-testid="workspace-sidebar-pin"]').click()
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      await window.waitForTimeout(300)

      const rail = await readSidebarRowGeometry(window, workspaceId, spaceId, agentId)
      expectDistanceWithin(docked.projectGroupLeftInset, docked.projectIconCenter / 2, 4)
      expect(docked.projectContentTopInset).toBeGreaterThanOrEqual(5)
      expect(docked.projectContentTopInset).toBeLessThanOrEqual(7)
      expect(docked.spaceSurfaceProjectLeftGap).toBeGreaterThanOrEqual(3)
      expect(docked.spaceSurfaceProjectLeftGap).toBeLessThanOrEqual(5)
      expect(docked.spaceSurfaceProjectRightGap).toBeGreaterThanOrEqual(5)
      expect(docked.spaceSurfaceProjectRightGap).toBeLessThanOrEqual(7)
      expect(docked.spaceSurfaceGutterDelta).toBeLessThanOrEqual(2)
      expectDistanceWithin(docked.spaceSurfaceCenter, docked.sidebarWidth / 2, 1)
      expect(docked.agentSurfaceProjectLeftGap).toBeGreaterThanOrEqual(3)
      expect(docked.agentSurfaceProjectLeftGap).toBeLessThanOrEqual(5)
      expect(docked.agentSurfaceProjectRightGap).toBeGreaterThanOrEqual(5)
      expect(docked.agentSurfaceProjectRightGap).toBeLessThanOrEqual(7)
      expect(docked.agentSurfaceGutterDelta).toBeLessThanOrEqual(2)
      expectDistanceWithin(docked.agentSurfaceCenter, docked.sidebarWidth / 2, 1)
      expectDistanceWithin(docked.agentSurfaceWidth, docked.spaceSurfaceWidth, 1)
      expectDistanceWithin(docked.agentSurfaceHeight, docked.spaceSurfaceHeight, 0.5)
      expect(docked.spaceBranchLeftInset).toBeGreaterThanOrEqual(docked.projectGroupLeftInset)
      expect(docked.spaceBranchGap).toBeGreaterThanOrEqual(2)
      expect(docked.spaceBranchGap).toBeLessThanOrEqual(3)
      expect(docked.spaceBranchTopGap).toBeGreaterThanOrEqual(2)
      expect(docked.spaceBranchTopGap).toBeLessThanOrEqual(4)
      expect(docked.spaceBranchBottomGap).toBeGreaterThanOrEqual(4)
      expect(docked.spaceBranchBottomGap).toBeLessThanOrEqual(6)
      expectDistanceWithin(docked.spaceNameLeft, docked.projectIconCenter, 1)
      expectDistanceWithin(docked.agentProviderCenter, docked.projectIconCenter, 1)
      expectDistanceWithin(docked.spaceToggleCenter, docked.projectToggleCenter, 1)
      expectDistanceWithin(docked.spaceToggleIconCenter, docked.projectToggleIconCenter, 1)

      expectDistanceWithin(rail.sidebarWidth, 52, 1)
      expectDistanceWithin(rail.spaceSurfaceWidth, 24, 1)
      expectDistanceWithin(rail.spaceSurfaceLeftInset, docked.spaceSurfaceLeftInset, 1)
      expectDistanceWithin(rail.spaceSurfaceHeight, docked.spaceSurfaceHeight, 0.5)
      expectDistanceWithin(rail.spaceSurfaceHeight, rail.spaceSurfaceWidth, 0.5)
      expect(rail.spaceSurfaceGutterDelta).toBeLessThanOrEqual(1)
      expect(rail.spaceSurfaceCenter).toBeCloseTo(rail.sidebarWidth / 2, 0)
      expect(rail.spaceBranchLeftInset).toBeGreaterThanOrEqual(rail.projectGroupLeftInset)
      expect(rail.spaceBranchGap).toBeGreaterThanOrEqual(2)
      expect(rail.spaceBranchGap).toBeLessThanOrEqual(3)
      expect(rail.spaceBranchTopGap).toBeGreaterThanOrEqual(2)
      expect(rail.spaceBranchTopGap).toBeLessThanOrEqual(4)
      expect(rail.spaceBranchBottomGap).toBeGreaterThanOrEqual(4)
      expect(rail.spaceBranchBottomGap).toBeLessThanOrEqual(6)
      expect(rail.agentSurfaceGutterDelta).toBeLessThanOrEqual(1)
      expect(rail.agentSurfaceCenter).toBeCloseTo(rail.sidebarWidth / 2, 0)
      expectDistanceWithin(rail.agentSurfaceWidth, rail.spaceSurfaceWidth, 1)
      expectDistanceWithin(rail.agentSurfaceLeftInset, docked.agentSurfaceLeftInset, 1)
      expectDistanceWithin(rail.agentSurfaceHeight, docked.agentSurfaceHeight, 0.5)
      expectDistanceWithin(rail.agentSurfaceHeight, rail.agentSurfaceWidth, 0.5)
      expectDistanceWithin(rail.projectIconCenter, rail.sidebarWidth / 2, 1)
      expectDistanceWithin(rail.pinButtonCenter, rail.sidebarWidth / 2, 1)
      expectDistanceWithin(rail.spaceToggleCenter, rail.sidebarWidth / 2, 1)
      expectDistanceWithin(rail.spaceToggleIconCenter, rail.sidebarWidth / 2, 1)
      expectDistanceWithin(rail.spaceRailIconCenter, rail.sidebarWidth / 2, 1)
      expectDistanceWithin(rail.agentProviderCenter, rail.sidebarWidth / 2, 1)
    } finally {
      await electronApp.close()
    }
  })
})
