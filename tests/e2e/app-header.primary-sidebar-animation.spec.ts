import { expect, test, type Page } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'

type SidebarAnimationSample = {
  elapsedMs: number
  width: number
  sameList: boolean
  sameWorkspaceItem: boolean
  itemGroupCount: number
}

type SidebarAnimationResult = {
  startClassName: string
  endClassName: string
  samples: SidebarAnimationSample[]
}

const sampleSidebarToggle = async (
  page: Page,
  workspaceId: string,
): Promise<SidebarAnimationResult> => {
  return await page.evaluate(async activeWorkspaceId => {
    const sidebar = document.querySelector('.workspace-sidebar')
    const listBefore = document.querySelector('.workspace-sidebar__list')
    const itemBefore = document.querySelector(`[data-testid="workspace-item-${activeWorkspaceId}"]`)
    const toggleButton = document.querySelector('[data-testid="workspace-sidebar-pin"]')

    if (
      !(sidebar instanceof HTMLElement) ||
      !(listBefore instanceof HTMLElement) ||
      !(itemBefore instanceof HTMLElement) ||
      !(toggleButton instanceof HTMLElement)
    ) {
      throw new Error('Sidebar animation measurement target not available')
    }

    const startClassName = sidebar.className
    toggleButton.click()

    return await new Promise<SidebarAnimationResult>(resolve => {
      const samples: SidebarAnimationSample[] = []
      const startTime = performance.now()
      const capture = (now: number): void => {
        const list = document.querySelector('.workspace-sidebar__list')
        const item = document.querySelector(`[data-testid="workspace-item-${activeWorkspaceId}"]`)

        samples.push({
          elapsedMs: Number((now - startTime).toFixed(2)),
          width: Number(sidebar.getBoundingClientRect().width.toFixed(2)),
          sameList: list === listBefore,
          sameWorkspaceItem: item === itemBefore,
          itemGroupCount: document.querySelectorAll(
            '.workspace-sidebar__list .workspace-item-group',
          ).length,
        })

        if (now - startTime < 360) {
          requestAnimationFrame(capture)
          return
        }

        resolve({
          startClassName,
          endClassName: sidebar.className,
          samples,
        })
      }

      requestAnimationFrame(capture)
    })
  }, workspaceId)
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

const expectContinuousSidebarAnimation = (
  result: SidebarAnimationResult,
  direction: 'collapse' | 'expand',
) => {
  const summary = summarize(result.samples)

  expect(summary.frameCount).toBeGreaterThan(8)
  expect(result.samples.every(sample => sample.sameList)).toBe(true)
  expect(result.samples.every(sample => sample.sameWorkspaceItem)).toBe(true)
  expect(result.samples.every(sample => sample.itemGroupCount > 0)).toBe(true)
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
                id: 'space-sidebar-animation',
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

      const collapse = await sampleSidebarToggle(window, workspaceId)
      await expect(sidebar).toHaveClass(/workspace-sidebar--rail/)
      expect(collapse.startClassName).toContain('workspace-sidebar--docked')
      expect(collapse.endClassName).toContain('workspace-sidebar--rail')
      expectContinuousSidebarAnimation(collapse, 'collapse')

      const expand = await sampleSidebarToggle(window, workspaceId)
      await expect(sidebar).toHaveClass(/workspace-sidebar--docked/)
      expect(expand.startClassName).toContain('workspace-sidebar--rail')
      expect(expand.endClassName).toContain('workspace-sidebar--docked')
      expectContinuousSidebarAnimation(expand, 'expand')
    } finally {
      await electronApp.close()
    }
  })
})
