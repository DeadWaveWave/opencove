import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

type SidebarAnimationSample = {
  elapsedMs: number
  width: number
  sameList: boolean
  sameWorkspaceItem: boolean
  sameProjectIcon: boolean
  itemGroupCount: number
  projectIconViewportCenterX: number
  projectIconCenterFromSidebarLeft: number
  projectNameViewportLeft: number
  spaceRailIconDisplay: string
  spaceRailIconOpacity: number
  spaceRailIconViewportCenterX: number
  spaceRailIconCenterFromSidebarLeft: number
  spaceRailSurfaceOpacity: number
  spaceRailSurfaceWidth: number
  spaceRailSurfaceHeight: number
  spaceNameOpacity: number
  spaceNameViewportLeft: number
  spaceNameWidth: number
  spaceToggleOpacity: number
  spaceToggleWidth: number
}

type SidebarAnimationResult = {
  startClassName: string
  endClassName: string
  samples: SidebarAnimationSample[]
}

const sampleSidebarToggle = async (
  page: Page,
  workspaceId: string,
  spaceId: string,
): Promise<SidebarAnimationResult> => {
  return await page.evaluate(
    async ({ activeWorkspaceId, activeSpaceId }) => {
      const sidebar = document.querySelector('.workspace-sidebar')
      const listBefore = document.querySelector('.workspace-sidebar__list')
      const itemBefore = document.querySelector(
        `[data-testid="workspace-item-${activeWorkspaceId}"]`,
      )
      const spaceItemSelector = `[data-testid="workspace-space-item-${activeWorkspaceId}-${activeSpaceId}"]`
      const spaceItem = document.querySelector(spaceItemSelector)
      const spaceRailIcon = spaceItem?.querySelector('.workspace-space-item__rail-icon')
      const spaceName = spaceItem?.querySelector('.workspace-space-item__name')
      const spaceToggle = spaceItem?.querySelector('.workspace-space-item__toggle')
      const projectName = itemBefore.querySelector('.workspace-item__name')
      const projectIconBefore = itemBefore.querySelector('.workspace-item__folder-icon')
      const toggleButton = document.querySelector('[data-testid="workspace-sidebar-pin"]')

      if (
        !(sidebar instanceof HTMLElement) ||
        !(listBefore instanceof HTMLElement) ||
        !(itemBefore instanceof HTMLElement) ||
        !(spaceItem instanceof HTMLElement) ||
        !(spaceRailIcon instanceof HTMLElement) ||
        !(spaceName instanceof HTMLElement) ||
        !(spaceToggle instanceof HTMLElement) ||
        !(projectName instanceof HTMLElement) ||
        !(projectIconBefore instanceof SVGElement) ||
        !(toggleButton instanceof HTMLElement)
      ) {
        throw new Error('Sidebar animation measurement target not available')
      }

      const startClassName = sidebar.className
      toggleButton.click()

      return await new Promise<SidebarAnimationResult>(resolve => {
        const sampleCount = 24
        const samples: SidebarAnimationSample[] = []
        const startTime = performance.now()
        const capture = (): void => {
          const now = performance.now()
          const list = document.querySelector('.workspace-sidebar__list')
          const item = document.querySelector(`[data-testid="workspace-item-${activeWorkspaceId}"]`)
          const projectIcon = item?.querySelector('.workspace-item__folder-icon')
          const spaceRailIconRect = spaceRailIcon.getBoundingClientRect()
          const sidebarRect = sidebar.getBoundingClientRect()
          const projectNameRect = projectName.getBoundingClientRect()
          const spaceNameRect = spaceName.getBoundingClientRect()
          const projectIconRect =
            projectIcon instanceof SVGElement
              ? projectIcon.getBoundingClientRect()
              : projectIconBefore.getBoundingClientRect()
          const spaceRailIconStyle = window.getComputedStyle(spaceRailIcon)
          const spaceRailSurfaceStyle = window.getComputedStyle(spaceItem, '::before')
          const spaceNameStyle = window.getComputedStyle(spaceName)
          const spaceToggleStyle = window.getComputedStyle(spaceToggle)

          samples.push({
            elapsedMs: Number((now - startTime).toFixed(2)),
            width: Number(sidebar.getBoundingClientRect().width.toFixed(2)),
            sameList: list === listBefore,
            sameWorkspaceItem: item === itemBefore,
            itemGroupCount: document.querySelectorAll(
              '.workspace-sidebar__list .workspace-item-group',
            ).length,
            sameProjectIcon: projectIcon === projectIconBefore,
            projectIconViewportCenterX: Number(
              (projectIconRect.x + projectIconRect.width / 2).toFixed(3),
            ),
            projectIconCenterFromSidebarLeft: Number(
              (projectIconRect.x + projectIconRect.width / 2 - sidebarRect.x).toFixed(3),
            ),
            projectNameViewportLeft: Number(projectNameRect.x.toFixed(3)),
            spaceRailIconDisplay: spaceRailIconStyle.display,
            spaceRailIconOpacity: Number.parseFloat(spaceRailIconStyle.opacity),
            spaceRailIconViewportCenterX: Number(
              (spaceRailIconRect.x + spaceRailIconRect.width / 2).toFixed(3),
            ),
            spaceRailIconCenterFromSidebarLeft: Number(
              (spaceRailIconRect.x + spaceRailIconRect.width / 2 - sidebarRect.x).toFixed(3),
            ),
            spaceRailSurfaceOpacity: Number.parseFloat(spaceRailSurfaceStyle.opacity),
            spaceRailSurfaceWidth: Number.parseFloat(spaceRailSurfaceStyle.width),
            spaceRailSurfaceHeight: Number.parseFloat(spaceRailSurfaceStyle.height),
            spaceNameOpacity: Number.parseFloat(spaceNameStyle.opacity),
            spaceNameViewportLeft: Number(spaceNameRect.x.toFixed(3)),
            spaceNameWidth: Number(spaceName.getBoundingClientRect().width.toFixed(3)),
            spaceToggleOpacity: Number.parseFloat(spaceToggleStyle.opacity),
            spaceToggleWidth: Number(spaceToggle.getBoundingClientRect().width.toFixed(3)),
          })

          if (samples.length < sampleCount) {
            window.setTimeout(capture, 16)
            return
          }

          resolve({
            startClassName,
            endClassName: sidebar.className,
            samples,
          })
        }

        window.setTimeout(capture, 16)
      })
    },
    { activeWorkspaceId: workspaceId, activeSpaceId: spaceId },
  )
}

const summarize = (samples: SidebarAnimationSample[]) => {
  const widths = samples.map(sample => sample.width)
  const deltas = widths.slice(1).map((width, index) => width - widths[index])
  return {
    frameCount: samples.length,
    firstWidth: widths[0] ?? 0,
    lastWidth: widths.at(-1) ?? 0,
    uniqueRoundedWidthCount: new Set(widths.map(width => Math.round(width))).size,
    maxPositiveDelta: Math.max(0, ...deltas),
    maxNegativeDelta: Math.min(0, ...deltas),
  }
}

const maxRange = (values: number[]) => Math.max(...values) - Math.min(...values)

const expectContinuousSidebarAnimation = (
  result: SidebarAnimationResult,
  direction: 'collapse' | 'expand',
) => {
  const summary = summarize(result.samples)

  expect(summary.frameCount).toBeGreaterThan(8)
  expect(result.samples.every(sample => sample.sameList)).toBe(true)
  expect(result.samples.every(sample => sample.sameWorkspaceItem)).toBe(true)
  expect(result.samples.every(sample => sample.sameProjectIcon)).toBe(true)
  expect(result.samples.every(sample => sample.itemGroupCount > 0)).toBe(true)
  expect(result.samples.every(sample => sample.spaceRailIconDisplay !== 'none')).toBe(true)
  expect(
    maxRange(result.samples.map(sample => sample.projectIconViewportCenterX)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(result.samples.map(sample => sample.projectNameViewportLeft)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(result.samples.map(sample => sample.spaceRailIconViewportCenterX)),
  ).toBeLessThanOrEqual(1)
  expect(maxRange(result.samples.map(sample => sample.spaceNameViewportLeft))).toBeLessThanOrEqual(
    1,
  )
  expect(
    result.samples.filter(
      sample =>
        sample.projectIconCenterFromSidebarLeft < 0 ||
        sample.projectIconCenterFromSidebarLeft > 72 ||
        sample.spaceRailIconCenterFromSidebarLeft < 0 ||
        sample.spaceRailIconCenterFromSidebarLeft > 72,
    ),
  ).toEqual([])
  expect(summary.uniqueRoundedWidthCount).toBeGreaterThan(3)

  if (direction === 'collapse') {
    expect(summary.firstWidth).toBeGreaterThan(summary.lastWidth)
    expect(summary.maxPositiveDelta).toBeLessThanOrEqual(2)
    return
  }

  expect(summary.lastWidth).toBeGreaterThan(summary.firstWidth)
  expect(summary.maxNegativeDelta).toBeGreaterThanOrEqual(-2)
}

test.describe('Primary Sidebar Animation', () => {
  test('animates between docked and rail without replacing the sidebar list', async () => {
    const { electronApp, window } = await launchApp()
    const workspaceId = 'workspace-sidebar-animation'
    const spaceId = 'space-sidebar-animation'

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: workspaceId,
        workspaces: [
          {
            id: workspaceId,
            name: 'Sidebar animation',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                'agent-sidebar-animation',
                'Sidebar animation agent',
                0,
                'Measure sidebar animation continuity',
                '2026-03-29T10:00:00.000Z',
              ),
            ],
            spaces: [
              {
                id: spaceId,
                name: 'Animation',
                directoryPath: testWorkspacePath,
                labelColor: 'blue',
                nodeIds: ['agent-sidebar-animation'],
              },
            ],
            activeSpaceId: 'space-sidebar-animation',
          },
        ],
      })

      const sidebar = window.locator('.workspace-sidebar')
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)

      const collapse = await sampleSidebarToggle(window, workspaceId, spaceId)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      expect(collapse.startClassName).toContain('workspace-sidebar--docked')
      expect(collapse.endClassName).toContain('workspace-sidebar--rail')
      expectContinuousSidebarAnimation(collapse, 'collapse')
      const collapsedFinal = collapse.samples.at(-1)
      if (!collapsedFinal) {
        throw new Error('Missing final collapsed sidebar animation sample')
      }
      expect(collapsedFinal.spaceRailIconOpacity).toBeGreaterThanOrEqual(0.95)
      expect(collapsedFinal.spaceRailSurfaceOpacity).toBeGreaterThanOrEqual(0.95)
      expect(collapsedFinal.spaceRailSurfaceWidth).toBeCloseTo(
        collapsedFinal.spaceRailSurfaceHeight,
        0,
      )
      expect(collapsedFinal.spaceNameOpacity).toBeLessThanOrEqual(0.05)
      expect(collapsedFinal.spaceToggleOpacity).toBeLessThanOrEqual(0.05)

      const expand = await sampleSidebarToggle(window, workspaceId, spaceId)
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      expect(expand.startClassName).toContain('workspace-sidebar--rail')
      expect(expand.endClassName).toContain('workspace-sidebar--docked')
      expectContinuousSidebarAnimation(expand, 'expand')
      const expandedFinal = expand.samples.at(-1)
      if (!expandedFinal) {
        throw new Error('Missing final expanded sidebar animation sample')
      }
      expect(expandedFinal.spaceRailIconOpacity).toBeLessThanOrEqual(0.05)
      expect(expandedFinal.spaceRailSurfaceOpacity).toBeLessThanOrEqual(0.05)
      expect(expandedFinal.spaceNameOpacity).toBeGreaterThanOrEqual(0.95)
      expect(expandedFinal.spaceNameWidth).toBeGreaterThan(20)
      expect(expandedFinal.spaceToggleOpacity).toBeGreaterThanOrEqual(0.95)
      expect(expandedFinal.spaceToggleWidth).toBeGreaterThan(20)
    } finally {
      await electronApp.close()
    }
  })
})
