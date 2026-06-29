import type { Terminal } from '@xterm/xterm'
import { readTerminalRenderDimensionsSafely } from './renderServiceSafety'
import type { PtySize } from './terminalGeometryTypes'

const DOM_RENDERER_TEXT_OVERHANG_SAFETY_CELLS = 1
const DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX = 0.5
const DOM_RENDERER_SCROLLBAR_GAP_SAFETY_CELLS = 1
const DOM_RENDERER_GLYPH_SCROLLBAR_GAP_SAFETY_CELLS = 2

function readMaxRowRight(rowsElement: Element, toLocalX: (value: number) => number): number | null {
  let maxRowRight: number | null = null
  for (const row of rowsElement.querySelectorAll(':scope > div')) {
    const rect = row.getBoundingClientRect()
    if (!Number.isFinite(rect.right)) {
      continue
    }

    const localRight = toLocalX(rect.right)
    if (!Number.isFinite(localRight)) {
      continue
    }

    maxRowRight = maxRowRight === null ? localRight : Math.max(maxRowRight, localRight)
  }

  return maxRowRight
}

function readMaxDescendantRight(
  rowsElement: Element,
  toLocalX: (value: number) => number,
): number | null {
  let maxDescendantRight: number | null = null
  for (const row of rowsElement.querySelectorAll(':scope > div')) {
    for (const child of row.querySelectorAll('*')) {
      const rect = child.getBoundingClientRect()
      if (!Number.isFinite(rect.right)) {
        continue
      }

      const localRight = toLocalX(rect.right)
      if (!Number.isFinite(localRight)) {
        continue
      }

      maxDescendantRight =
        maxDescendantRight === null ? localRight : Math.max(maxDescendantRight, localRight)
    }
  }

  return maxDescendantRight
}

function resolveDomRendererRectScaleX(screenElement: HTMLElement, screenRect: DOMRect): number {
  const screenWidth = screenElement.clientWidth
  if (
    Number.isFinite(screenWidth) &&
    screenWidth > 0 &&
    Number.isFinite(screenRect.width) &&
    screenRect.width > 0
  ) {
    return screenRect.width / screenWidth
  }

  return 1
}

function getDomRendererTextFootprint(container: HTMLElement): {
  contentWidth: number
  outerWidth: number
  screenToScrollbarGapPx: number | null
  textToScrollbarGapPx: number | null
  glyphToScrollbarGapPx: number | null
} | null {
  const xtermElement = container.querySelector('.xterm')
  const screenElement = container.querySelector('.xterm-screen')
  const rowsElement =
    screenElement?.querySelector('.xterm-rows') ?? container.querySelector('.xterm-rows')
  if (
    !(xtermElement instanceof HTMLElement) ||
    !(screenElement instanceof HTMLElement) ||
    !(rowsElement instanceof HTMLElement)
  ) {
    return null
  }

  const screenRect = screenElement.getBoundingClientRect()
  const rectScaleX = resolveDomRendererRectScaleX(screenElement, screenRect)
  const toLocalX = (value: number): number => (value - screenRect.left) / rectScaleX
  const screenRight = screenElement.clientWidth
  const scrollbarElement = container.querySelector('.xterm-scrollable-element .scrollbar.vertical')
  const scrollbarRect =
    scrollbarElement instanceof HTMLElement ? scrollbarElement.getBoundingClientRect() : null
  const scrollbarLeft =
    scrollbarRect &&
    Number.isFinite(scrollbarRect.left) &&
    Number.isFinite(scrollbarRect.width) &&
    Number.isFinite(scrollbarRect.height) &&
    scrollbarRect.width > 0 &&
    scrollbarRect.height > 0
      ? toLocalX(scrollbarRect.left)
      : null
  const screenToScrollbarGapPx =
    scrollbarLeft !== null && Number.isFinite(scrollbarLeft) ? scrollbarLeft - screenRight : null
  const maxRowRight = readMaxRowRight(rowsElement, toLocalX)
  const maxDescendantRight = readMaxDescendantRight(rowsElement, toLocalX)
  const maxVisibleTextRight =
    maxRowRight === null && maxDescendantRight === null
      ? null
      : Math.max(
          maxRowRight ?? Number.NEGATIVE_INFINITY,
          maxDescendantRight ?? Number.NEGATIVE_INFINITY,
        )
  const visualRight =
    maxVisibleTextRight === null ? screenRight : Math.max(screenRight, maxVisibleTextRight)
  const hasVisibleTextOverhang =
    maxVisibleTextRight !== null &&
    maxVisibleTextRight > screenRight + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX
  const hasDescendantOverhang =
    maxDescendantRight !== null &&
    maxRowRight !== null &&
    maxDescendantRight > maxRowRight + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX
  const textToScrollbarGapPx =
    scrollbarLeft === null || !hasVisibleTextOverhang ? null : scrollbarLeft - visualRight
  const glyphToScrollbarGapPx =
    scrollbarLeft === null || !hasDescendantOverhang ? null : scrollbarLeft - maxDescendantRight
  const visibleContentOverflowPx =
    maxVisibleTextRight === null ? 0 : Math.max(0, maxVisibleTextRight - screenRight)
  const contentWidth = screenRight + visibleContentOverflowPx
  const outerWidth = Math.min(container.clientWidth, xtermElement.clientWidth)
  if (
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(outerWidth) ||
    contentWidth <= 0 ||
    outerWidth <= 0
  ) {
    return null
  }

  return {
    contentWidth,
    outerWidth,
    screenToScrollbarGapPx,
    textToScrollbarGapPx,
    glyphToScrollbarGapPx,
  }
}

function resolveDomRendererScrollbarGapSafeCols({
  baselineCols,
  measured,
  cellWidth,
  screenToScrollbarGapPx,
  safetyCells = DOM_RENDERER_SCROLLBAR_GAP_SAFETY_CELLS,
}: {
  baselineCols: number
  measured: PtySize
  cellWidth: number
  screenToScrollbarGapPx: number | null
  safetyCells?: number
}): number | null {
  if (screenToScrollbarGapPx === null || measured.cols <= 1) {
    return null
  }

  const targetGapPx = safetyCells * cellWidth
  const projectedGapPx = screenToScrollbarGapPx - (measured.cols - baselineCols) * cellWidth
  if (projectedGapPx + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX >= targetGapPx) {
    return null
  }

  const safeExtraCols = Math.floor(
    (screenToScrollbarGapPx - targetGapPx + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX) / cellWidth,
  )
  const safeCols = Math.min(measured.cols - 1, baselineCols + safeExtraCols)
  return safeCols > 0 && safeCols < measured.cols ? safeCols : null
}

export function resolveDomRendererSafeMeasuredSize({
  terminal,
  container,
  measured,
  referenceCols,
}: {
  terminal: Terminal
  container: HTMLElement
  measured: PtySize
  referenceCols?: number
}): PtySize {
  if (container.dataset?.coveTerminalRenderer !== 'dom') {
    return measured
  }

  const cellWidth = readTerminalRenderDimensionsSafely(terminal)?.css?.cell?.width
  if (typeof cellWidth !== 'number' || !Number.isFinite(cellWidth) || cellWidth <= 0) {
    return measured
  }

  if (terminal.cols <= 0) {
    return measured
  }

  const baselineCols =
    typeof referenceCols === 'number' && Number.isFinite(referenceCols) && referenceCols > 0
      ? Math.floor(referenceCols)
      : terminal.cols
  const footprint = getDomRendererTextFootprint(container)
  if (!footprint) {
    return measured
  }

  let safeCols = measured.cols

  const expectedCurrentTextWidth = baselineCols * cellWidth
  const hasVisibleTextOverhang =
    footprint.contentWidth > expectedCurrentTextWidth + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX

  if (hasVisibleTextOverhang && footprint.screenToScrollbarGapPx === null) {
    const measuredCellFootprint = footprint.contentWidth / baselineCols
    const safeCellFootprint = Math.max(cellWidth, measuredCellFootprint)
    const measuredAvailableTextWidth = measured.cols * cellWidth
    const safeTextWidth = Math.min(footprint.outerWidth, measuredAvailableTextWidth)
    const overhangSafetyPx = DOM_RENDERER_TEXT_OVERHANG_SAFETY_CELLS * cellWidth
    const overhangSafeCols = Math.floor((safeTextWidth - overhangSafetyPx) / safeCellFootprint)
    if (Number.isFinite(overhangSafeCols) && overhangSafeCols > 0) {
      safeCols = Math.min(safeCols, overhangSafeCols)
    }
  }

  const scrollbarGapSafeCols = resolveDomRendererScrollbarGapSafeCols({
    baselineCols,
    measured,
    cellWidth,
    screenToScrollbarGapPx: footprint.screenToScrollbarGapPx,
  })
  if (scrollbarGapSafeCols !== null) {
    safeCols = Math.min(safeCols, scrollbarGapSafeCols)
  }

  const visibleTextScrollbarGapSafeCols = resolveDomRendererScrollbarGapSafeCols({
    baselineCols,
    measured,
    cellWidth,
    screenToScrollbarGapPx: footprint.textToScrollbarGapPx,
  })
  if (visibleTextScrollbarGapSafeCols !== null) {
    safeCols = Math.min(safeCols, visibleTextScrollbarGapSafeCols)
  }

  const glyphScrollbarGapSafeCols = resolveDomRendererScrollbarGapSafeCols({
    baselineCols,
    measured,
    cellWidth,
    screenToScrollbarGapPx: footprint.glyphToScrollbarGapPx,
    safetyCells: DOM_RENDERER_GLYPH_SCROLLBAR_GAP_SAFETY_CELLS,
  })
  if (glyphScrollbarGapSafeCols !== null) {
    safeCols = Math.min(safeCols, glyphScrollbarGapSafeCols)
  }

  if (!Number.isFinite(safeCols) || safeCols <= 0 || safeCols >= measured.cols) {
    return measured
  }

  return {
    cols: Math.max(1, safeCols),
    rows: measured.rows,
  }
}
