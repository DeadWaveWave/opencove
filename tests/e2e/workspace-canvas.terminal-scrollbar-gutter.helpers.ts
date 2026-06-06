import { expect, type Locator, type Page } from '@playwright/test'
import {
  buildEchoSequenceCommand,
  buildNodeEvalCommand,
  readCanvasViewport,
} from './workspace-canvas.helpers'

type ScrollMetrics = {
  baseY: number
  viewportY: number
  instanceId: number
  offsetFromBottom: number
}

async function assertScrollbarHitTarget(window: Page, nodeId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await window.evaluate(id => {
          const nodeElement = document.querySelector(
            `.react-flow__node[data-id="${id}"] .terminal-node`,
          )
          const sliderElement = nodeElement?.querySelector(
            '.xterm-scrollable-element .scrollbar.vertical .slider',
          )
          const scrollbarElement = nodeElement?.querySelector(
            '.xterm-scrollable-element .scrollbar.vertical',
          )
          if (
            !(nodeElement instanceof HTMLElement) ||
            !(sliderElement instanceof HTMLElement) ||
            !(scrollbarElement instanceof HTMLElement)
          ) {
            return null
          }

          const sliderRect = sliderElement.getBoundingClientRect()
          const point = {
            x: sliderRect.left + sliderRect.width / 2,
            y: sliderRect.top + sliderRect.height / 2,
          }
          const hitTarget = document.elementFromPoint(point.x, point.y)
          return {
            hitScrollbar:
              hitTarget?.closest('.xterm-scrollable-element .scrollbar.vertical') ===
              scrollbarElement,
            hitResizer: hitTarget?.closest('.terminal-node__resizer') !== null,
            hitClass:
              hitTarget instanceof HTMLElement
                ? hitTarget.className
                : (hitTarget?.nodeName ?? null),
          }
        }, nodeId),
      { timeout: 5_000 },
    )
    .toMatchObject({
      hitScrollbar: true,
      hitResizer: false,
    })
}

async function assertInteriorContentCell(window: Page, nodeId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await window.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const size = api?.getSize(id)
          const renderMetrics = api?.getRenderMetrics(id)
          if (!api || !size || !renderMetrics?.cssCellWidth) {
            return { ok: false as const, reason: 'missing terminal metrics' }
          }

          const targetCol = Math.max(size.cols - 2, 1)
          const targetRow = Math.max(size.rows - 2, 1)
          const center = api.getCellCenter(id, targetCol, targetRow)
          const nodeElement = document.querySelector(
            `.react-flow__node[data-id="${id}"] .terminal-node`,
          )
          const terminalSurface = nodeElement?.querySelector('.terminal-node__terminal')
          const screenElement = nodeElement?.querySelector('.xterm-screen')
          const scrollbarElement = nodeElement?.querySelector(
            '.xterm-scrollable-element .scrollbar.vertical',
          )
          if (
            !center ||
            !(terminalSurface instanceof HTMLElement) ||
            !(screenElement instanceof HTMLElement)
          ) {
            return { ok: false as const, reason: 'missing terminal surface' }
          }

          const pointInsideRect = (rect: DOMRect, point: { x: number; y: number }): boolean =>
            point.x >= rect.left + 0.5 &&
            point.x <= rect.right - 0.5 &&
            point.y >= rect.top + 0.5 &&
            point.y <= rect.bottom - 0.5
          const hitTarget = document.elementFromPoint(center.x, center.y)

          return {
            ok: true as const,
            insideScreenBounds: pointInsideRect(screenElement.getBoundingClientRect(), center),
            insideScrollbarBounds:
              scrollbarElement instanceof HTMLElement
                ? pointInsideRect(scrollbarElement.getBoundingClientRect(), center)
                : false,
            insideResizerBounds: Array.from(
              nodeElement?.querySelectorAll('.terminal-node__resizer') ?? [],
            ).some(resizer =>
              resizer instanceof HTMLElement
                ? pointInsideRect(resizer.getBoundingClientRect(), center)
                : false,
            ),
            insideScreen: hitTarget?.closest('.xterm-screen') === screenElement,
            rendererKind: terminalSurface.dataset.coveTerminalRenderer ?? null,
          }
        }, nodeId),
      { timeout: 5_000 },
    )
    .toMatchObject({
      ok: true,
      insideScreenBounds: true,
      insideScrollbarBounds: false,
      insideResizerBounds: false,
    })
}

async function assertDomRendererOverflowIfPresent(window: Page, nodeId: string): Promise<void> {
  const domOverflow = await window.evaluate(id => {
    const nodeElement = document.querySelector(`.react-flow__node[data-id="${id}"] .terminal-node`)
    const terminalSurface = nodeElement?.querySelector('.terminal-node__terminal')
    const xtermElement = nodeElement?.querySelector('.xterm')
    const screenElement = nodeElement?.querySelector('.xterm-screen')
    const rowElement = nodeElement?.querySelector('.xterm-rows > div')
    if (
      !(terminalSurface instanceof HTMLElement) ||
      terminalSurface.dataset.coveTerminalRenderer !== 'dom' ||
      !(xtermElement instanceof HTMLElement) ||
      !(screenElement instanceof HTMLElement) ||
      !(rowElement instanceof HTMLElement)
    ) {
      return null
    }

    const xtermStyle = window.getComputedStyle(xtermElement)
    const screenStyle = window.getComputedStyle(screenElement)
    const rowStyle = window.getComputedStyle(rowElement)
    return {
      xtermOverflowX: xtermStyle.overflowX,
      xtermOverflowY: xtermStyle.overflowY,
      screenOverflowX: screenStyle.overflowX,
      screenOverflowY: screenStyle.overflowY,
      rowOverflowX: rowStyle.overflowX,
      rowOverflowY: rowStyle.overflowY,
    }
  }, nodeId)

  if (domOverflow !== null) {
    expect(domOverflow).toMatchObject({
      xtermOverflowX: 'visible',
      xtermOverflowY: 'visible',
      screenOverflowX: 'visible',
      screenOverflowY: 'visible',
      rowOverflowX: 'visible',
      rowOverflowY: 'visible',
    })
  }
}

async function assertOverviewRulerAndScrollbarGap(window: Page, nodeId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await window.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const renderMetrics = api?.getRenderMetrics(id)
          const nodeElement = document.querySelector(
            `.react-flow__node[data-id="${id}"] .terminal-node`,
          )
          const xtermElement = nodeElement?.querySelector('.xterm')
          const screenElement = nodeElement?.querySelector('.xterm-screen')
          const scrollbarElement = nodeElement?.querySelector(
            '.xterm-scrollable-element .scrollbar.vertical',
          )
          const overviewRulerElement = nodeElement?.querySelector(
            '.xterm-decoration-overview-ruler',
          )
          if (
            !(xtermElement instanceof HTMLElement) ||
            !(screenElement instanceof HTMLElement) ||
            !(scrollbarElement instanceof HTMLElement) ||
            !(overviewRulerElement instanceof HTMLElement) ||
            !renderMetrics?.cssCellWidth
          ) {
            return null
          }

          const xtermStyle = window.getComputedStyle(xtermElement)
          const horizontalPadding =
            (Number.parseFloat(xtermStyle.paddingLeft) || 0) +
            (Number.parseFloat(xtermStyle.paddingRight) || 0)
          const gutter =
            Math.round(
              (xtermElement.clientWidth - horizontalPadding - screenElement.clientWidth) * 100,
            ) / 100
          const screenToScrollbarGap =
            scrollbarElement.getBoundingClientRect().left -
            screenElement.getBoundingClientRect().right
          const columnOverflow =
            Math.round(
              ((api?.getSize(id)?.cols ?? 0) * renderMetrics.cssCellWidth -
                screenElement.clientWidth) *
                100,
            ) / 100

          return {
            overviewRulerHidden:
              Math.round(overviewRulerElement.getBoundingClientRect().width * 100) / 100 < 0.5,
            hasSafetyGap: gutter >= renderMetrics.cssCellWidth,
            isTextCloseToScrollbar: screenToScrollbarGap <= renderMetrics.cssCellWidth * 2,
            columnsFitScreen: columnOverflow <= 0,
            gutterPx: gutter,
          }
        }, nodeId),
      { timeout: 5_000 },
    )
    .toMatchObject({
      overviewRulerHidden: true,
      hasSafetyGap: true,
      isTextCloseToScrollbar: true,
      columnsFitScreen: true,
      gutterPx: expect.any(Number),
    })
}

async function scrollAwayFromBottom(window: Page, nodeId: string): Promise<ScrollMetrics> {
  await expect
    .poll(
      async () =>
        await window.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const metrics = api?.getRenderMetrics(id)
          if (!api || !metrics || metrics.baseY === null) {
            return null
          }

          const targetLine = Math.max(0, metrics.baseY - 30)
          return api.scrollToLine(id, targetLine) ? api.getViewportY(id) : null
        }, nodeId),
      { timeout: 5_000 },
    )
    .toEqual(expect.any(Number))

  const metricsBeforeZoom = await window.evaluate(id => {
    const metrics = window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)
    if (
      !metrics ||
      metrics.baseY === null ||
      metrics.viewportY === null ||
      metrics.instanceId === null
    ) {
      return null
    }

    return {
      baseY: metrics.baseY,
      viewportY: metrics.viewportY,
      instanceId: metrics.instanceId,
      offsetFromBottom: metrics.baseY - metrics.viewportY,
    }
  }, nodeId)

  expect(metricsBeforeZoom).not.toBeNull()
  expect(metricsBeforeZoom!.viewportY).toBeLessThan(metricsBeforeZoom!.baseY)
  expect(metricsBeforeZoom!.offsetFromBottom).toBeGreaterThan(0)
  return metricsBeforeZoom!
}

async function assertScrollStateSurvivesZoomAndResize(
  window: Page,
  node: Locator,
  nodeId: string,
  metricsBeforeZoom: ScrollMetrics,
): Promise<void> {
  const zoomInButton = window.locator('.react-flow__controls-zoomin')
  await expect(zoomInButton).toBeVisible()
  const zoomBefore = (await readCanvasViewport(window)).zoom
  await zoomInButton.click()
  await expect
    .poll(async () => (await readCanvasViewport(window)).zoom, { timeout: 5_000 })
    .toBeGreaterThan(zoomBefore)
  await window.waitForTimeout(150)

  const rightResizerBox = await node
    .locator('[data-testid="terminal-resizer-right"]')
    .evaluate(el => {
      const rect = el.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  await window.mouse.move(
    rightResizerBox.x + rightResizerBox.width / 2,
    rightResizerBox.y + rightResizerBox.height / 2,
  )
  await window.mouse.down()
  await window.mouse.move(
    rightResizerBox.x + rightResizerBox.width / 2 + 96,
    rightResizerBox.y + rightResizerBox.height / 2,
    { steps: 8 },
  )
  await window.mouse.up()

  await expect
    .poll(
      async () =>
        await window.evaluate(
          ({ id, instanceIdBeforeZoom }) => {
            const metrics = window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)
            return Boolean(
              metrics &&
              metrics.baseY !== null &&
              metrics.viewportY !== null &&
              metrics.instanceId === instanceIdBeforeZoom &&
              metrics.viewportY < metrics.baseY,
            )
          },
          { id: nodeId, instanceIdBeforeZoom: metricsBeforeZoom.instanceId },
        ),
      { timeout: 5_000 },
    )
    .toBe(true)
}

async function assertRedrawKeepsContentInsideScreen(
  window: Page,
  node: Locator,
  nodeId: string,
): Promise<void> {
  await node.locator('.xterm').click()
  await expect(node.locator('.xterm-helper-textarea')).toBeFocused()
  await window.keyboard.type(
    buildNodeEvalCommand(`
      const lines = Array.from({ length: 120 }, (_, index) => 'OPENCOVE_REDRAW_' + index.toString().padStart(3, '0')).join('\\n')
      process.stdout.write('\\u001b[2J\\u001b[H' + lines + '\\n')
      setInterval(() => {}, 1000)
    `),
  )
  await window.keyboard.press('Enter')
  await expect(node).toContainText('OPENCOVE_REDRAW_119', { timeout: 20_000 })

  await expect
    .poll(
      async () =>
        await window.evaluate(id => {
          const metrics = window.__opencoveTerminalSelectionTestApi?.getRenderMetrics(id)
          return metrics?.viewportY === null || metrics?.baseY === null
            ? null
            : metrics.viewportY > 0 && metrics.viewportY >= metrics.baseY
        }, nodeId),
      { timeout: 5_000 },
    )
    .toBe(true)

  await expect
    .poll(
      async () =>
        await window.evaluate(id => {
          const api = window.__opencoveTerminalSelectionTestApi
          const size = api?.getSize(id)
          const screenElement = document.querySelector(
            `.react-flow__node[data-id="${id}"] .terminal-node .xterm-screen`,
          )
          if (!api || !size || !(screenElement instanceof HTMLElement)) {
            return null
          }
          const center = api.getCellCenter(
            id,
            Math.max(size.cols - 2, 1),
            Math.max(size.rows - 2, 1),
          )
          const target = center ? document.elementFromPoint(center.x, center.y) : null
          return { insideScreen: target?.closest('.xterm-screen') === screenElement }
        }, nodeId),
      { timeout: 5_000 },
    )
    .toMatchObject({ insideScreen: true })
}

export async function assertTerminalScrollbarGutterSurface(
  window: Page,
  nodeId: string,
  node: Locator,
): Promise<void> {
  const xterm = node.locator('.xterm')
  const tailToken = `OPENCOVE_SCROLLBAR_GUTTER_${nodeId}_220`
  await xterm.click()
  await expect(node.locator('.xterm-helper-textarea')).toBeFocused()
  await window.keyboard.type(buildEchoSequenceCommand(`OPENCOVE_SCROLLBAR_GUTTER_${nodeId}`, 220))
  await window.keyboard.press('Enter')
  await expect(node).toContainText(tailToken, { timeout: 20_000 })

  await expect(node.locator('.xterm-scrollable-element .scrollbar.vertical .slider')).toBeVisible({
    timeout: 20_000,
  })
  await expect(node.locator('.xterm-viewport')).toHaveCSS('overflow-y', 'hidden')
  await expect(node.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(node.locator('.terminal-node__terminal')).not.toHaveCSS(
    'background-color',
    'rgb(0, 0, 0)',
  )

  await assertScrollbarHitTarget(window, nodeId)
  await assertInteriorContentCell(window, nodeId)
  await assertDomRendererOverflowIfPresent(window, nodeId)
  await assertOverviewRulerAndScrollbarGap(window, nodeId)

  const metricsBeforeZoom = await scrollAwayFromBottom(window, nodeId)
  await assertScrollStateSurvivesZoomAndResize(window, node, nodeId, metricsBeforeZoom)
  await assertRedrawKeepsContentInsideScreen(window, node, nodeId)
}
