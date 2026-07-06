import { expect, test } from '@playwright/test'
import { launchApp, seedWorkspaceState, testWorkspacePath } from './workspace-canvas.helpers'
import { createRailAgent } from './sidebar-test-fixtures'
import {
  sampleSidebarToggle,
  type SidebarAnimationResult,
  type SidebarAnimationSample,
} from './app-header.primary-sidebar-animation.helpers'

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

const expectStableRange = (
  samples: SidebarAnimationSample[],
  readValue: (sample: SidebarAnimationSample) => number,
  tolerance = 1,
) => {
  expect(maxRange(samples.map(readValue))).toBeLessThanOrEqual(tolerance)
}

const expectClose = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

const maxStep = (values: number[], direction: 'positive' | 'negative') => {
  const deltas = values.slice(1).map((value, index) => value - values[index])
  return direction === 'positive' ? Math.max(0, ...deltas) : Math.min(0, ...deltas)
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
  expect(result.samples.every(sample => sample.projectToggleOpacity >= 0.95)).toBe(true)
  expect(result.samples.every(sample => sample.spaceToggleOpacity >= 0.95)).toBe(true)
  expect(result.samples.every(sample => sample.spaceRailSurfaceOpacity >= 0.95)).toBe(true)
  expect(result.samples.every(sample => sample.spaceItemBackground === 'rgba(0, 0, 0, 0)')).toBe(
    true,
  )
  expect(result.samples.every(sample => sample.spaceItemBorderColor === 'rgba(0, 0, 0, 0)')).toBe(
    true,
  )
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
  expectClose(firstTransition.spaceItemViewportLeft, result.before.spaceItemViewportLeft, 1)
  expectClose(firstTransition.spaceItemViewportTop, result.before.spaceItemViewportTop, 1)
  expectStableRange(transitionSamples, sample => sample.paddingLeft, 0.1)
  expectStableRange(transitionSamples, sample => sample.pinButtonViewportCenterX)
  expectStableRange(transitionSamples, sample => sample.pinButtonViewportCenterY)
  expectStableRange(transitionSamples, sample => sample.projectIconViewportCenterX)
  expectStableRange(transitionSamples, sample => sample.projectIconViewportCenterY)
  expectStableRange(transitionSamples, sample => sample.projectNameViewportLeft)
  expectStableRange(transitionSamples, sample => sample.spaceRailIconViewportCenterY)
  expectStableRange(transitionSamples, sample => sample.spaceItemViewportLeft)
  expectStableRange(transitionSamples, sample => sample.spaceItemViewportTop)
  expectStableRange(transitionSamples, sample => sample.spaceNameViewportLeft)
  expect(
    transitionSamples
      .filter(sample => sample.spaceRailSurfaceWidth > sample.spaceItemHeight + 2)
      .every(
        sample => Math.abs(sample.spaceToggleViewportRight - sample.spaceRailSurfaceRight) <= 8,
      ),
  ).toBe(true)
  expect(
    transitionSamples.filter(
      sample =>
        sample.projectIconCenterFromSidebarLeft < 0 || sample.projectIconCenterFromSidebarLeft > 72,
    ),
  ).toEqual([])
  expect(summary.uniqueRoundedWidthCount).toBeGreaterThan(3)

  const toggleCenterXs = transitionSamples.map(sample => sample.spaceRailIconViewportCenterX)
  expect(maxRange(toggleCenterXs)).toBeGreaterThan(40)
  if (direction === 'collapse') {
    expect(maxStep(toggleCenterXs, 'positive')).toBeLessThanOrEqual(2)
  } else {
    expect(maxStep(toggleCenterXs, 'negative')).toBeGreaterThanOrEqual(-2)
  }

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
      expect(finalSample.projectNameVisibleWidth).toBeLessThanOrEqual(1)
      expect(finalSample.projectNameOpacity).toBeLessThanOrEqual(0.1)
      expect(finalSample.projectToggleVisibleWidth).toBeLessThanOrEqual(1)
      expect(finalSample.spaceNameVisibleWidth).toBeLessThanOrEqual(1)
      expect(finalSample.spaceNameOpacity).toBeLessThanOrEqual(0.1)
      expectClose(
        finalSample.spaceRailSurfaceRight - finalSample.spaceRailSurfaceWidth / 2,
        finalSample.spaceRailIconViewportCenterX,
        1,
      )
      expectClose(finalSample.spaceRailSurfaceWidth, finalSample.spaceItemHeight, 0.5)
      expectClose(finalSample.spaceRailSurfaceHeight, finalSample.spaceItemHeight, 0.5)
    }
    expect(
      maxStep(
        result.samples.map(sample => sample.spaceNameVisibleWidth),
        'positive',
      ),
    ).toBeLessThanOrEqual(2)
    expect(
      maxStep(
        result.samples.map(sample => sample.spaceRailSurfaceWidth),
        'positive',
      ),
    ).toBeLessThanOrEqual(2)
    expect(
      transitionSamples.some(
        sample =>
          sample.spaceRailSurfaceWidth > sample.spaceItemHeight + 2 &&
          sample.spaceRailSurfaceWidth < result.before.spaceRailSurfaceWidth - 2,
      ),
    ).toBe(true)
    return
  }

  const finalSample = result.samples.at(-1)
  const finalSpaceNameWidth = finalSample?.spaceNameWidth ?? 0
  expect(summary.lastWidth).toBeGreaterThan(summary.firstWidth)
  expect(summary.maxNegativeDelta).toBeGreaterThanOrEqual(-2)
  expect(result.before.projectNameVisibleWidth).toBeLessThanOrEqual(1)
  expect(result.before.projectToggleVisibleWidth).toBeLessThanOrEqual(1)
  expect(result.before.spaceNameVisibleWidth).toBeLessThanOrEqual(1)
  expect(result.before.spaceNameOpacity).toBeLessThanOrEqual(0.1)
  expectClose(
    result.before.spaceRailSurfaceRight - result.before.spaceRailSurfaceWidth / 2,
    result.before.spaceRailIconViewportCenterX,
    1,
  )
  expect(
    maxStep(
      result.samples.map(sample => sample.spaceNameVisibleWidth),
      'negative',
    ),
  ).toBeGreaterThanOrEqual(-2)
  expect(
    maxStep(
      result.samples.map(sample => sample.spaceRailSurfaceWidth),
      'negative',
    ),
  ).toBeGreaterThanOrEqual(-2)
  expect(
    transitionSamples.some(
      sample => sample.spaceNameWidth > 2 && sample.spaceNameWidth < finalSpaceNameWidth - 2,
    ),
  ).toBe(true)
  expect(
    transitionSamples.some(
      sample =>
        sample.spaceRailSurfaceWidth > result.before.spaceRailSurfaceWidth + 2 &&
        sample.spaceRailSurfaceWidth < sample.spaceItemWidth - 2,
    ),
  ).toBe(true)
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
      expect(collapsedFinal.spaceRailIconOpacity).toBeGreaterThanOrEqual(0.95)
      expect(collapsedFinal.spaceItemWidth).toBeGreaterThan(100)
      expectClose(collapsedFinal.spaceRailSurfaceWidth, collapsedFinal.spaceItemHeight, 0.5)
      expectClose(collapsedFinal.spaceRailSurfaceHeight, collapsedFinal.spaceItemHeight, 0.5)
      expect(collapsedFinal.projectNameVisibleWidth).toBeLessThanOrEqual(1)
      expect(collapsedFinal.projectNameOpacity).toBeLessThanOrEqual(0.1)
      expect(collapsedFinal.spaceNameVisibleWidth).toBeLessThanOrEqual(1)
      expect(collapsedFinal.spaceNameOpacity).toBeLessThanOrEqual(0.1)
      expectClose(
        collapsedFinal.spaceRailSurfaceRight - collapsedFinal.spaceRailSurfaceWidth / 2,
        collapsedFinal.spaceRailIconViewportCenterX,
        1,
      )

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
      expect(expandedFinal.spaceRailSurfaceOpacity).toBeGreaterThanOrEqual(0.95)
      expect(expandedFinal.spaceRailSurfaceWidth).toBeGreaterThan(100)
      expectClose(expandedFinal.spaceRailSurfaceWidth, expandedFinal.spaceItemWidth, 0.5)
      expectClose(expandedFinal.spaceRailSurfaceHeight, expandedFinal.spaceItemHeight, 0.5)
      expect(expandedFinal.spaceNameOpacity).toBeGreaterThanOrEqual(0.95)
      expect(expandedFinal.spaceNameVisibleWidth).toBeGreaterThan(20)
      expect(expandedFinal.spaceNameWidth).toBeGreaterThan(20)
      expect(expandedFinal.spaceToggleOpacity).toBeGreaterThanOrEqual(0.95)
      expect(expandedFinal.spaceToggleVisibleWidth).toBeGreaterThan(20)
    } finally {
      await electronApp.close()
    }
  })
})
