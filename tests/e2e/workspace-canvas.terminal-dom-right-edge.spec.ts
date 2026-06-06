import { expect, test, type Page } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
} from './workspace-canvas.helpers'

type RightEdgeMetrics = {
  rendererKind: string | null
  cols: number | null
  proposedCols: number | null
  cssCellWidth: number | null
  screenScaleX: number
  rowTextLength: number
  glyphOverflowBeyondScreenLocalPx: number | null
  glyphToContainerGapLocalPx: number | null
  glyphToXtermGapLocalPx: number | null
  screenToContainerGapLocalPx: number | null
  screenToScrollbarGapLocalPx: number | null
  textToScrollbarGapLocalPx: number | null
  terminalOverflowX: string | null
  xtermOverflowX: string | null
  screenOverflowX: string | null
  rowOverflowX: string | null
}

async function readRightEdgeMetrics(
  window: Page,
  nodeId: string,
): Promise<RightEdgeMetrics | null> {
  return await window.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const size = api?.getSize(id) ?? null
    const proposed = api?.getProposedGeometry(id) ?? null
    const renderMetrics = api?.getRenderMetrics(id) ?? null
    const nodeElement = document.querySelector(`.react-flow__node[data-id="${id}"] .terminal-node`)
    const terminalSurface = nodeElement?.querySelector('.terminal-node__terminal')
    const xtermElement = nodeElement?.querySelector('.xterm')
    const screenElement = nodeElement?.querySelector('.xterm-screen')
    const rowsElement = nodeElement?.querySelector('.xterm-rows')
    const rowElement = rowsElement?.querySelector(':scope > div')
    const scrollbarElement = nodeElement?.querySelector(
      '.xterm-scrollable-element .scrollbar.vertical',
    )

    if (
      !(terminalSurface instanceof HTMLElement) ||
      !(xtermElement instanceof HTMLElement) ||
      !(screenElement instanceof HTMLElement) ||
      !(rowElement instanceof HTMLElement) ||
      !size ||
      !renderMetrics?.cssCellWidth
    ) {
      return null
    }

    const screenRect = screenElement.getBoundingClientRect()
    const screenScaleX =
      screenElement.clientWidth > 0 && screenRect.width > 0
        ? screenRect.width / screenElement.clientWidth
        : 1
    const toLocalGap = (gap: number): number => Math.round((gap / screenScaleX) * 100) / 100

    const spanRects = Array.from(rowElement.querySelectorAll('span'))
      .map(span => span.getBoundingClientRect())
      .filter(rect => Number.isFinite(rect.right))
    const maxSpanRight =
      spanRects.length > 0 ? Math.max(...spanRects.map(rect => rect.right)) : null
    const containerRect = terminalSurface.getBoundingClientRect()
    const xtermRect = xtermElement.getBoundingClientRect()
    const scrollbarRect =
      scrollbarElement instanceof HTMLElement ? scrollbarElement.getBoundingClientRect() : null
    const scrollbarLeft =
      scrollbarRect &&
      Number.isFinite(scrollbarRect.left) &&
      scrollbarRect.width > 0 &&
      scrollbarRect.height > 0
        ? scrollbarRect.left
        : null
    const terminalStyle = window.getComputedStyle(terminalSurface)
    const xtermStyle = window.getComputedStyle(xtermElement)
    const screenStyle = window.getComputedStyle(screenElement)
    const rowStyle = window.getComputedStyle(rowElement)

    return {
      rendererKind: terminalSurface.dataset.coveTerminalRenderer ?? null,
      cols: size.cols,
      proposedCols: proposed?.cols ?? null,
      cssCellWidth: renderMetrics.cssCellWidth,
      screenScaleX: Math.round(screenScaleX * 1000) / 1000,
      rowTextLength: rowElement.textContent?.length ?? 0,
      glyphOverflowBeyondScreenLocalPx:
        maxSpanRight === null ? null : toLocalGap(maxSpanRight - screenRect.right),
      glyphToContainerGapLocalPx:
        maxSpanRight === null ? null : toLocalGap(containerRect.right - maxSpanRight),
      glyphToXtermGapLocalPx:
        maxSpanRight === null ? null : toLocalGap(xtermRect.right - maxSpanRight),
      screenToContainerGapLocalPx: toLocalGap(containerRect.right - screenRect.right),
      screenToScrollbarGapLocalPx:
        scrollbarLeft === null ? null : toLocalGap(scrollbarLeft - screenRect.right),
      textToScrollbarGapLocalPx:
        scrollbarLeft === null || maxSpanRight === null
          ? null
          : toLocalGap(scrollbarLeft - maxSpanRight),
      terminalOverflowX: terminalStyle.overflowX,
      xtermOverflowX: xtermStyle.overflowX,
      screenOverflowX: screenStyle.overflowX,
      rowOverflowX: rowStyle.overflowX,
    }
  }, nodeId)
}

async function writeLastColumnGlyph(window: Page, nodeId: string): Promise<void> {
  const terminal = window.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node`)
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await window.keyboard.type(
    buildNodeEvalCommand(`
      const cols = Math.max(2, process.stdout.columns || 80)
      process.stdout.write('\\u001b[2J\\u001b[H' + 'A'.repeat(cols - 1) + '\\u2588')
      setInterval(() => {}, 1000)
    `),
  )
  await window.keyboard.press('Enter')

  await expect
    .poll(async () => (await readRightEdgeMetrics(window, nodeId))?.rowTextLength ?? 0, {
      timeout: 20_000,
    })
    .toBeGreaterThan(2)
}

test.describe('Workspace Canvas - DOM terminal right edge', () => {
  test('keeps last-column DOM glyphs away from the outer clipping edge across zoom', async () => {
    const nodeId = 'node-terminal-dom-right-edge'
    const { electronApp, window } = await launchApp({ windowMode: 'offscreen' })

    try {
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: nodeId,
            title: 'terminal-dom-right-edge',
            position: { x: 160, y: 140 },
            width: 560,
            height: 340,
          },
        ],
        { settings: { terminalFontSize: 13 } },
      )

      const terminal = window.locator(`.react-flow__node[data-id="${nodeId}"] .terminal-node`)
      await expect(terminal).toBeVisible()
      await expect(terminal.locator('.xterm')).toBeVisible()

      await writeLastColumnGlyph(window, nodeId)

      const initialMetrics = await readRightEdgeMetrics(window, nodeId)
      expect(initialMetrics).toMatchObject({
        rendererKind: 'dom',
        terminalOverflowX: 'hidden',
        xtermOverflowX: 'visible',
        screenOverflowX: 'visible',
        rowOverflowX: 'visible',
      })
      expect((initialMetrics?.proposedCols ?? 0) - (initialMetrics?.cols ?? 0)).toBe(5)
      expect(initialMetrics?.glyphToContainerGapLocalPx ?? -1).toBeGreaterThanOrEqual(2)

      const zoomInButton = window.locator('.react-flow__controls-zoomin')
      await expect(zoomInButton).toBeVisible()
      await zoomInButton.click()
      await expect
        .poll(async () => (await readCanvasViewport(window)).zoom, { timeout: 5_000 })
        .toBeGreaterThan(1.01)

      const zoomedMetrics = await readRightEdgeMetrics(window, nodeId)
      expect(zoomedMetrics?.cols).toBe(initialMetrics?.cols)
      expect(zoomedMetrics?.proposedCols).toBe(initialMetrics?.proposedCols)
      expect(zoomedMetrics?.glyphToContainerGapLocalPx ?? -1).toBeGreaterThanOrEqual(2)
    } finally {
      await electronApp.close()
    }
  })
})
