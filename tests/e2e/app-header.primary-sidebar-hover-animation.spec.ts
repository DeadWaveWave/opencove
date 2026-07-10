import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

type HoverPeekSample = {
  sidebarTransition: string
  width: number
  sidebarRight: number
  listOpacity: number
  listTransform: string
  nameVisibleWidth: number
  iconCenterX: number
  hiddenRailIconOpacity: number
  surfaceWidth: number
  surfaceRight: number
  spaceToggleRight: number
  spaceToggleVisibleWidth: number
  switchAllVisibleWidth: number
}

const maxRange = (values: number[]) => Math.max(...values) - Math.min(...values)

const maxStep = (values: number[], direction: 'positive' | 'negative') => {
  const deltas = values.slice(1).map((value, index) => value - values[index])
  return direction === 'positive' ? Math.max(0, ...deltas) : Math.min(0, ...deltas)
}

const sampleHoverPeek = async (page: Page): Promise<HoverPeekSample[]> => {
  const sampling = page.evaluate(async () => {
    const sidebar = document.querySelector('.workspace-sidebar')
    const list = document.querySelector('.workspace-sidebar__list')
    const spaceItem = document.querySelector('.workspace-space-item--space')
    const spaceName = spaceItem?.querySelector('.workspace-space-item__name')
    const hiddenRailIcon = spaceItem?.querySelector('.workspace-space-item__rail-icon')
    const spaceToggle = spaceItem?.querySelector('.workspace-space-item__toggle')
    const switchAll = document.querySelector('[data-testid="workspace-space-switch-all"]')

    if (
      !(sidebar instanceof HTMLElement) ||
      !(list instanceof HTMLElement) ||
      !(spaceItem instanceof HTMLElement) ||
      !(spaceName instanceof HTMLElement) ||
      !(hiddenRailIcon instanceof HTMLElement) ||
      !(spaceToggle instanceof HTMLElement) ||
      !(switchAll instanceof HTMLElement)
    ) {
      throw new Error('Hover sidebar animation measurement target not available')
    }

    const readSample = (): HoverPeekSample => {
      const sidebarRect = sidebar.getBoundingClientRect()
      const listStyle = window.getComputedStyle(list)
      const itemRect = spaceItem.getBoundingClientRect()
      const nameRect = spaceName.getBoundingClientRect()
      const iconRect = spaceToggle.getBoundingClientRect()
      const toggleRect = spaceToggle.getBoundingClientRect()
      const switchAllRect = switchAll.getBoundingClientRect()
      const hiddenRailIconStyle = window.getComputedStyle(hiddenRailIcon)
      const surfaceStyle = window.getComputedStyle(spaceItem, '::before')
      const surfaceLeft = itemRect.left + Number.parseFloat(surfaceStyle.left)
      const surfaceWidth = Number.parseFloat(surfaceStyle.width)
      const visibleInSidebar = (rect: DOMRect): number =>
        Number(
          Math.max(
            0,
            Math.min(rect.right, sidebarRect.right) - Math.max(rect.left, sidebarRect.left),
          ).toFixed(3),
        )

      return {
        sidebarTransition: sidebar.dataset.coveSidebarTransition ?? 'idle',
        width: Number(sidebarRect.width.toFixed(3)),
        sidebarRight: Number(sidebarRect.right.toFixed(3)),
        listOpacity: Number.parseFloat(listStyle.opacity),
        listTransform: listStyle.transform,
        nameVisibleWidth: visibleInSidebar(nameRect),
        iconCenterX: Number((iconRect.x + iconRect.width / 2).toFixed(3)),
        hiddenRailIconOpacity: Number.parseFloat(hiddenRailIconStyle.opacity),
        surfaceWidth,
        surfaceRight: Number((surfaceLeft + surfaceWidth).toFixed(3)),
        spaceToggleRight: Number(toggleRect.right.toFixed(3)),
        spaceToggleVisibleWidth: visibleInSidebar(toggleRect),
        switchAllVisibleWidth: visibleInSidebar(switchAllRect),
      }
    }

    const samples: HoverPeekSample[] = [readSample()]
    const captureFrames = async (remainingFrameCount: number): Promise<void> => {
      if (remainingFrameCount <= 0) {
        return
      }
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
      samples.push(readSample())
      await captureFrames(remainingFrameCount - 1)
    }

    await captureFrames(35)
    await new Promise(resolve => window.setTimeout(resolve, 250))
    samples.push(readSample())
    return samples
  })

  await page.mouse.move(600, 360)
  await page.mouse.move(35, 120)
  return await sampling
}

test.describe('Primary Sidebar Hover Animation', () => {
  test('auto reveal expands by clipping without list fade or translate flicker', async () => {
    const { electronApp, window } = await launchApp()

    try {
      await seedWorkspaceState(window, {
        activeWorkspaceId: 'workspace-hover-animation',
        workspaces: [
          {
            id: 'workspace-hover-animation',
            name: 'Hover animation',
            path: testWorkspacePath,
            nodes: [
              createRailAgent(
                'agent-hover-animation',
                'Hover animation agent',
                0,
                'Measure hover animation',
                '2026-03-29T10:00:00.000Z',
              ),
            ],
            spaces: [
              {
                id: 'space-hover-animation',
                name: 'Hover animation space',
                directoryPath: testWorkspacePath,
                labelColor: 'blue',
                nodeIds: ['agent-hover-animation'],
              },
            ],
            activeSpaceId: 'space-hover-animation',
          },
        ],
      })

      await window.locator('[data-testid="workspace-sidebar-pin"]').click()
      await expect(window.locator('.workspace-sidebar')).toHaveClass(/workspace-sidebar--rail/)
      await expect(window.locator('.workspace-sidebar')).toHaveAttribute(
        'data-cove-sidebar-transition',
        'idle',
      )

      const samples = await sampleHoverPeek(window)
      const transitionSamples = samples.filter(sample => sample.sidebarTransition !== 'idle')
      const finalSample = samples.at(-1)

      expect(transitionSamples.length).toBeGreaterThan(4)
      expect(samples.every(sample => sample.listOpacity >= 0.99)).toBe(true)
      expect(samples.every(sample => sample.listTransform === 'none')).toBe(true)
      expect(samples.every(sample => sample.hiddenRailIconOpacity <= 0.05)).toBe(true)
      expect(maxRange(samples.map(sample => sample.iconCenterX))).toBeGreaterThan(40)
      expect(
        maxStep(
          samples.map(sample => sample.iconCenterX),
          'negative',
        ),
      ).toBeGreaterThanOrEqual(-2)
      expect(
        maxStep(
          samples.map(sample => sample.width),
          'negative',
        ),
      ).toBeGreaterThanOrEqual(-2)
      expect(
        maxStep(
          samples.map(sample => sample.surfaceWidth),
          'negative',
        ),
      ).toBeGreaterThanOrEqual(-2)
      expect(
        maxStep(
          samples.map(sample => sample.nameVisibleWidth),
          'negative',
        ),
      ).toBeGreaterThanOrEqual(-2)
      expect(new Set(samples.map(sample => Math.round(sample.width))).size).toBeGreaterThan(3)
      expect(
        transitionSamples.some(sample => sample.surfaceWidth > 30 && sample.surfaceWidth < 220),
      ).toBe(true)
      expect(
        transitionSamples
          .filter(sample => sample.surfaceWidth > 54)
          .every(sample => Math.abs(sample.spaceToggleRight - sample.surfaceRight) <= 8),
      ).toBe(true)
      expect(
        maxStep(
          transitionSamples.map(sample => sample.spaceToggleRight),
          'negative',
        ),
      ).toBeGreaterThanOrEqual(-2)
      expect(
        transitionSamples.some(
          sample => sample.switchAllVisibleWidth > 0 && sample.switchAllVisibleWidth < 24,
        ),
      ).toBe(true)
      expect(finalSample?.width).toBeGreaterThanOrEqual(276)
      expect(finalSample?.surfaceWidth).toBeGreaterThan(100)
      expect(finalSample?.nameVisibleWidth).toBeGreaterThan(20)
    } finally {
      await electronApp.close()
    }
  })
})
