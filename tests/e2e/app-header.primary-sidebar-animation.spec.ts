import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

type SidebarAnimationSample = {
  label: string
  elapsedMs: number
  sidebarTransition: string
  width: number
  paddingLeft: number
  sameList: boolean
  sameWorkspaceItem: boolean
  sameProjectIcon: boolean
  itemGroupCount: number
  pinButtonViewportCenterX: number
  pinButtonViewportCenterY: number
  projectIconViewportCenterX: number
  projectIconViewportCenterY: number
  projectIconCenterFromSidebarLeft: number
  projectNameOpacity: number
  projectNameViewportLeft: number
  projectToggleOpacity: number
  spaceRailIconDisplay: string
  spaceRailIconOpacity: number
  spaceItemViewportLeft: number
  spaceItemViewportTop: number
  spaceRailIconViewportCenterX: number
  spaceRailIconViewportCenterY: number
  spaceRailIconCenterFromSidebarLeft: number
  spaceRailSurfaceOpacity: number
  spaceRailSurfaceWidth: number
  spaceRailSurfaceHeight: number
  spaceItemWidth: number
  spaceItemHeight: number
  spaceNameOpacity: number
  spaceNameViewportLeft: number
  spaceNameWidth: number
  spaceToggleOpacity: number
  spaceToggleWidth: number
}

type SidebarAnimationResult = {
  startClassName: string
  endClassName: string
  before: SidebarAnimationSample
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
      const projectToggle = itemBefore.querySelector('.workspace-item__tree-toggle')
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
        !(projectToggle instanceof HTMLElement) ||
        !(projectIconBefore instanceof SVGElement) ||
        !(toggleButton instanceof HTMLElement)
      ) {
        throw new Error('Sidebar animation measurement target not available')
      }

      const readSample = (label: string, elapsedMs: number): SidebarAnimationSample => {
        const list = document.querySelector('.workspace-sidebar__list')
        const item = document.querySelector(`[data-testid="workspace-item-${activeWorkspaceId}"]`)
        const projectIcon = item?.querySelector('.workspace-item__folder-icon')
        const spaceItemRect = spaceItem.getBoundingClientRect()
        const spaceRailIconRect = spaceRailIcon.getBoundingClientRect()
        const sidebarRect = sidebar.getBoundingClientRect()
        const sidebarStyle = window.getComputedStyle(sidebar)
        const pinButtonRect = toggleButton.getBoundingClientRect()
        const projectNameRect = projectName.getBoundingClientRect()
        const spaceNameRect = spaceName.getBoundingClientRect()
        const projectIconRect =
          projectIcon instanceof SVGElement
            ? projectIcon.getBoundingClientRect()
            : projectIconBefore.getBoundingClientRect()
        const projectNameStyle = window.getComputedStyle(projectName)
        const projectToggleStyle = window.getComputedStyle(projectToggle)
        const spaceRailIconStyle = window.getComputedStyle(spaceRailIcon)
        const spaceRailSurfaceStyle = window.getComputedStyle(spaceItem, '::before')
        const spaceNameStyle = window.getComputedStyle(spaceName)
        const spaceToggleStyle = window.getComputedStyle(spaceToggle)

        return {
          label,
          elapsedMs: Number(elapsedMs.toFixed(2)),
          sidebarTransition: sidebar.dataset.coveSidebarTransition ?? 'idle',
          width: Number(sidebarRect.width.toFixed(2)),
          paddingLeft: Number.parseFloat(sidebarStyle.paddingLeft),
          sameList: list === listBefore,
          sameWorkspaceItem: item === itemBefore,
          itemGroupCount: document.querySelectorAll(
            '.workspace-sidebar__list .workspace-item-group',
          ).length,
          sameProjectIcon: projectIcon === projectIconBefore,
          pinButtonViewportCenterX: Number((pinButtonRect.x + pinButtonRect.width / 2).toFixed(3)),
          pinButtonViewportCenterY: Number((pinButtonRect.y + pinButtonRect.height / 2).toFixed(3)),
          projectIconViewportCenterX: Number(
            (projectIconRect.x + projectIconRect.width / 2).toFixed(3),
          ),
          projectIconViewportCenterY: Number(
            (projectIconRect.y + projectIconRect.height / 2).toFixed(3),
          ),
          projectIconCenterFromSidebarLeft: Number(
            (projectIconRect.x + projectIconRect.width / 2 - sidebarRect.x).toFixed(3),
          ),
          projectNameOpacity: Number.parseFloat(projectNameStyle.opacity),
          projectNameViewportLeft: Number(projectNameRect.x.toFixed(3)),
          projectToggleOpacity: Number.parseFloat(projectToggleStyle.opacity),
          spaceRailIconDisplay: spaceRailIconStyle.display,
          spaceRailIconOpacity: Number.parseFloat(spaceRailIconStyle.opacity),
          spaceItemViewportLeft: Number(spaceItemRect.x.toFixed(3)),
          spaceItemViewportTop: Number(spaceItemRect.y.toFixed(3)),
          spaceRailIconViewportCenterX: Number(
            (spaceRailIconRect.x + spaceRailIconRect.width / 2).toFixed(3),
          ),
          spaceRailIconViewportCenterY: Number(
            (spaceRailIconRect.y + spaceRailIconRect.height / 2).toFixed(3),
          ),
          spaceRailIconCenterFromSidebarLeft: Number(
            (spaceRailIconRect.x + spaceRailIconRect.width / 2 - sidebarRect.x).toFixed(3),
          ),
          spaceRailSurfaceOpacity: Number.parseFloat(spaceRailSurfaceStyle.opacity),
          spaceRailSurfaceWidth: Number.parseFloat(spaceRailSurfaceStyle.width),
          spaceRailSurfaceHeight: Number.parseFloat(spaceRailSurfaceStyle.height),
          spaceItemWidth: Number(spaceItemRect.width.toFixed(3)),
          spaceItemHeight: Number(spaceItemRect.height.toFixed(3)),
          spaceNameOpacity: Number.parseFloat(spaceNameStyle.opacity),
          spaceNameViewportLeft: Number(spaceNameRect.x.toFixed(3)),
          spaceNameWidth: Number(spaceName.getBoundingClientRect().width.toFixed(3)),
          spaceToggleOpacity: Number.parseFloat(spaceToggleStyle.opacity),
          spaceToggleWidth: Number(spaceToggle.getBoundingClientRect().width.toFixed(3)),
        }
      }

      const startClassName = sidebar.className
      const before = readSample('before', 0)
      toggleButton.click()

      return await new Promise<SidebarAnimationResult>(resolve => {
        const sampleCount = 30
        const samples: SidebarAnimationSample[] = []
        const startTime = performance.now()
        const capture = (label: string): void => {
          const now = performance.now()
          samples.push(readSample(label, now - startTime))
        }

        const captureAnimationFrame = (index: number): void => {
          capture(`raf-${index}`)

          if (index + 1 < sampleCount) {
            window.requestAnimationFrame(() => captureAnimationFrame(index + 1))
            return
          }

          window.setTimeout(() => {
            capture('settled')
            resolve({
              startClassName,
              endClassName: sidebar.className,
              before,
              samples,
            })
          }, 200)
        }

        window.requestAnimationFrame(() => captureAnimationFrame(0))
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

const expectClose = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

const expectContinuousSidebarAnimation = (
  result: SidebarAnimationResult,
  direction: 'collapse' | 'expand',
) => {
  const summary = summarize(result.samples)
  const transitionSamples = result.samples.filter(sample => sample.sidebarTransition !== 'idle')
  const firstTransition = transitionSamples[0]
  const lastTransition = transitionSamples.at(-1)

  expect(summary.frameCount).toBeGreaterThan(8)
  expect(transitionSamples.length).toBeGreaterThan(4)
  expect(result.samples.every(sample => sample.sameList)).toBe(true)
  expect(result.samples.every(sample => sample.sameWorkspaceItem)).toBe(true)
  expect(result.samples.every(sample => sample.sameProjectIcon)).toBe(true)
  expect(result.samples.every(sample => sample.itemGroupCount > 0)).toBe(true)
  expect(result.samples.every(sample => sample.spaceRailIconDisplay !== 'none')).toBe(true)
  expect(firstTransition).toBeDefined()
  expect(lastTransition).toBeDefined()
  if (!firstTransition || !lastTransition) {
    return
  }
  expectClose(firstTransition.pinButtonViewportCenterX, result.before.pinButtonViewportCenterX, 1)
  expectClose(firstTransition.pinButtonViewportCenterY, result.before.pinButtonViewportCenterY, 1)
  expectClose(
    firstTransition.projectIconViewportCenterX,
    result.before.projectIconViewportCenterX,
    1,
  )
  expectClose(
    firstTransition.projectIconViewportCenterY,
    result.before.projectIconViewportCenterY,
    1,
  )
  if (direction === 'expand') {
    expectClose(
      firstTransition.spaceRailIconViewportCenterX,
      result.before.spaceRailIconViewportCenterX,
      1,
    )
    expectClose(
      firstTransition.spaceRailIconViewportCenterY,
      result.before.spaceRailIconViewportCenterY,
      1,
    )
  }
  expectClose(firstTransition.spaceItemViewportLeft, result.before.spaceItemViewportLeft, 1)
  expectClose(firstTransition.spaceItemViewportTop, result.before.spaceItemViewportTop, 1)
  expect(maxRange(transitionSamples.map(sample => sample.paddingLeft))).toBeLessThanOrEqual(0.1)
  expect(
    maxRange(transitionSamples.map(sample => sample.pinButtonViewportCenterX)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.pinButtonViewportCenterY)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.projectIconViewportCenterX)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.projectIconViewportCenterY)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.projectNameViewportLeft)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.spaceRailIconViewportCenterX)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.spaceRailIconViewportCenterY)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.spaceItemViewportLeft)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.spaceItemViewportTop)),
  ).toBeLessThanOrEqual(1)
  expect(
    maxRange(transitionSamples.map(sample => sample.spaceNameViewportLeft)),
  ).toBeLessThanOrEqual(1)
  expect(
    transitionSamples.filter(
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
    const finalSample = result.samples.at(-1)
    if (finalSample) {
      expectClose(finalSample.pinButtonViewportCenterX, lastTransition.pinButtonViewportCenterX, 1)
      expectClose(finalSample.pinButtonViewportCenterY, lastTransition.pinButtonViewportCenterY, 1)
      expectClose(
        finalSample.projectIconViewportCenterX,
        lastTransition.projectIconViewportCenterX,
        1,
      )
      expectClose(
        finalSample.projectIconViewportCenterY,
        lastTransition.projectIconViewportCenterY,
        1,
      )
      expectClose(
        finalSample.spaceRailIconViewportCenterX,
        lastTransition.spaceRailIconViewportCenterX,
        1,
      )
      expectClose(
        finalSample.spaceRailIconViewportCenterY,
        lastTransition.spaceRailIconViewportCenterY,
        1,
      )
      expectClose(finalSample.spaceItemViewportLeft, lastTransition.spaceItemViewportLeft, 1)
      expectClose(finalSample.spaceItemViewportTop, lastTransition.spaceItemViewportTop, 1)
    }
    return
  }

  expect(summary.lastWidth).toBeGreaterThan(summary.firstWidth)
  expect(summary.maxNegativeDelta).toBeGreaterThanOrEqual(-2)
  expect(firstTransition.projectNameOpacity).toBeLessThanOrEqual(0.05)
  expect(firstTransition.projectToggleOpacity).toBeLessThanOrEqual(0.05)
  expect(firstTransition.spaceNameOpacity).toBeLessThanOrEqual(0.05)
  expect(firstTransition.spaceToggleOpacity).toBeLessThanOrEqual(0.05)
  expect(transitionSamples.slice(0, 4).every(sample => sample.spaceNameOpacity <= 0.05)).toBe(true)
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
      expect(collapsedFinal.sidebarTransition).toBe('idle')
      expect(collapsedFinal.spaceItemWidth).toBeCloseTo(collapsedFinal.spaceItemHeight, 0)
      expect(collapsedFinal.spaceItemWidth).toBeLessThanOrEqual(30)
      expect(collapsedFinal.spaceRailIconOpacity).toBeGreaterThanOrEqual(0.95)
      expect(collapsedFinal.spaceNameOpacity).toBeLessThanOrEqual(0.05)
      expect(collapsedFinal.spaceToggleOpacity).toBeLessThanOrEqual(0.05)
      expect(collapsedFinal.spaceToggleWidth).toBeLessThanOrEqual(1)

      const expand = await sampleSidebarToggle(window, workspaceId, spaceId)
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      expect(expand.startClassName).toContain('workspace-sidebar--rail')
      expect(expand.endClassName).toContain('workspace-sidebar--docked')
      expectContinuousSidebarAnimation(expand, 'expand')
      const expandedFinal = expand.samples.at(-1)
      if (!expandedFinal) {
        throw new Error('Missing final expanded sidebar animation sample')
      }
      expect(expandedFinal.sidebarTransition).toBe('idle')
      expect(expandedFinal.spaceItemWidth).toBeGreaterThan(100)
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
