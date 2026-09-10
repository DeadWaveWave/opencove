import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'
import {
  sampleSidebarToggle,
  type SidebarAnimationResult,
} from './app-header.primary-sidebar-animation.helpers'

function expectStableProjectRail(result: SidebarAnimationResult): void {
  const samples = [result.before, ...result.samples]
  expect(samples.every(sample => sample.sameRail)).toBe(true)
  expect(samples.every(sample => sample.sameWorkspaceItem)).toBe(true)
  expect(samples.every(sample => sample.sameProjectIcon)).toBe(true)
  expect(samples.every(sample => sample.railSpaceCount === 0 && sample.railAgentCount === 0)).toBe(
    true,
  )
  const range = (values: number[]) => Math.max(...values) - Math.min(...values)
  expect(range(samples.map(sample => sample.railWidth))).toBeLessThanOrEqual(1)
  expect(range(samples.map(sample => sample.projectIconCenterX))).toBeLessThanOrEqual(1)
  expect(range(samples.map(sample => sample.projectIconCenterY))).toBeLessThanOrEqual(1)
  expect(result.samples.at(-1)?.sidebarTransition).toBe('idle')
}

test.describe('Primary Sidebar Animation', () => {
  for (const uiTheme of ['pixel', 'pixel-light'] as const) {
    test(`keeps the project rail stable while pinning navigation in ${uiTheme}`, async ({
      browserName: _browserName,
    }, testInfo) => {
      const { electronApp, window } = await launchApp()
      const workspaceId = 'workspace-sidebar-animation'

      try {
        await seedWorkspaceState(window, {
          activeWorkspaceId: workspaceId,
          settings: { uiTheme },
          workspaces: [
            {
              id: workspaceId,
              name: 'OpenCove',
              path: testWorkspacePath,
              nodes: [
                createRailAgent(
                  'agent-animation',
                  'Polish navigation',
                  0,
                  'Review UI',
                  '2026-09-10T10:00:00.000Z',
                ),
              ],
              spaces: [
                {
                  id: 'space-animation',
                  name: 'ui/chrome',
                  directoryPath: testWorkspacePath,
                  labelColor: 'blue',
                  nodeIds: ['agent-animation'],
                },
              ],
              activeSpaceId: 'space-animation',
            },
          ],
        })
        await window.mouse.move(800, 450)
        const sidebar = window.getByTestId('workspace-sidebar')
        await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
        const collapse = await sampleSidebarToggle(window, workspaceId)
        expectStableProjectRail(collapse)
        expect(collapse.endClassName).toContain('workspace-sidebar--rail')
        expect(collapse.samples.at(-1)?.panelCount).toBe(0)
        expect(collapse.samples.at(-1)?.sidebarWidth).toBeLessThan(collapse.before.sidebarWidth)

        const expand = await sampleSidebarToggle(window, workspaceId)
        expectStableProjectRail(expand)
        expect(expand.endClassName).toContain('workspace-sidebar--docked')
        expect(expand.samples.at(-1)?.panelCount).toBe(1)
        expect(expand.samples.at(-1)?.sidebarWidth).toBeGreaterThan(expand.before.sidebarWidth)
        await testInfo.attach(`sidebar-pinned-${uiTheme}`, {
          body: await window.screenshot(),
          contentType: 'image/png',
        })
      } finally {
        await electronApp.close()
      }
    })
  }
})
