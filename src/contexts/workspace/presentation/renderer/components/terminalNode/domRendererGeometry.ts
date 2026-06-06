import type { Terminal } from '@xterm/xterm'
import {
  readTerminalRenderDimensionsSafely,
  runTerminalRenderMutationSafely,
} from './renderServiceSafety'
import type { PtySize } from './terminalGeometryTypes'

const DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX = 0.5
const DOM_RENDERER_DIMENSION_EPSILON_PX = 0.5
const DOM_RENDERER_GEOMETRY_CALIBRATION_COLS = 5

function roundCssPixelValue(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function releaseXtermRootHeightForMeasurement(terminal: Terminal): void {
  if (!terminal.element) {
    return
  }

  terminal.element.style.height = ''
}

export function calibrateMeasuredGeometryForRenderer({
  container,
  measured,
}: {
  container: HTMLElement | null
  measured: PtySize
}): PtySize {
  if (container?.dataset?.coveTerminalRenderer !== 'dom') {
    return measured
  }

  return {
    cols: Math.max(1, measured.cols - DOM_RENDERER_GEOMETRY_CALIBRATION_COLS),
    rows: measured.rows,
  }
}

/**
 * xterm fit floors rows while the flex container may retain fractional leftover height.
 * Clamp the xterm root to the current rendered rows on every refresh so stale px
 * heights are replaced after startup, font metric, or zoom changes.
 */
export function clampXtermHeightToExactRows(terminal: Terminal): void {
  const xtermEl = terminal.element
  if (!xtermEl) {
    return
  }

  const cssCellHeight = readTerminalRenderDimensionsSafely(terminal)?.css?.cell?.height
  const contentHeight =
    typeof cssCellHeight === 'number' && Number.isFinite(cssCellHeight) && cssCellHeight > 0
      ? terminal.rows * cssCellHeight
      : null
  if (contentHeight === null || !Number.isFinite(contentHeight) || contentHeight <= 0) {
    return
  }

  const computedStyle =
    typeof window.getComputedStyle === 'function' ? window.getComputedStyle(xtermEl) : null
  const parsePixelValue = (value: string | undefined): number => {
    const parsed = Number.parseFloat(value ?? '')
    return Number.isFinite(parsed) ? parsed : 0
  }
  const verticalPadding =
    parsePixelValue(computedStyle?.paddingTop) + parsePixelValue(computedStyle?.paddingBottom)
  const exactHeight =
    computedStyle?.boxSizing === 'border-box' ? contentHeight + verticalPadding : contentHeight
  xtermEl.style.height = `${roundCssPixelValue(exactHeight)}px`
}

export function syncDomRendererDimensionsToCurrentGeometry({
  terminal,
  container,
  force = false,
}: {
  terminal: Terminal
  container: HTMLElement | null
  force?: boolean
}): void {
  if (container?.dataset?.coveTerminalRenderer !== 'dom') {
    return
  }

  const renderDimensions = readTerminalRenderDimensionsSafely(terminal)
  const cssCellWidth = renderDimensions?.css?.cell?.width
  const cssCellHeight = renderDimensions?.css?.cell?.height
  const cssCanvasWidth = renderDimensions?.css?.canvas?.width
  const cssCanvasHeight = renderDimensions?.css?.canvas?.height

  if (
    typeof cssCellWidth !== 'number' ||
    typeof cssCellHeight !== 'number' ||
    typeof cssCanvasWidth !== 'number' ||
    typeof cssCanvasHeight !== 'number' ||
    !Number.isFinite(cssCellWidth) ||
    !Number.isFinite(cssCellHeight) ||
    !Number.isFinite(cssCanvasWidth) ||
    !Number.isFinite(cssCanvasHeight) ||
    cssCellWidth <= 0 ||
    cssCellHeight <= 0
  ) {
    return
  }

  const expectedCanvasWidth = terminal.cols * cssCellWidth
  const expectedCanvasHeight = terminal.rows * cssCellHeight
  const hasStaleDimensions = (dimensions: typeof renderDimensions): boolean => {
    const currentCssCanvasWidth = dimensions?.css?.canvas?.width
    const currentCssCanvasHeight = dimensions?.css?.canvas?.height
    return (
      typeof currentCssCanvasWidth !== 'number' ||
      typeof currentCssCanvasHeight !== 'number' ||
      !Number.isFinite(currentCssCanvasWidth) ||
      !Number.isFinite(currentCssCanvasHeight) ||
      Math.abs(currentCssCanvasWidth - expectedCanvasWidth) > DOM_RENDERER_DIMENSION_EPSILON_PX ||
      Math.abs(currentCssCanvasHeight - expectedCanvasHeight) > DOM_RENDERER_DIMENSION_EPSILON_PX
    )
  }

  // Skip check if force is true (e.g., after viewport zoom change)
  if (!force && !hasStaleDimensions(renderDimensions)) {
    return
  }

  const internalTerminal = terminal as Terminal & {
    _core?: {
      _renderService?: {
        handleResize?: (cols: number, rows: number) => void
        _renderer?: {
          value?: {
            handleResize?: (cols: number, rows: number) => void
          }
        }
      }
    }
  }
  runTerminalRenderMutationSafely(() => {
    const renderService = internalTerminal._core?._renderService

    // First, call renderService.handleResize if available
    if (typeof renderService?.handleResize === 'function') {
      renderService.handleResize(terminal.cols, terminal.rows)
    }

    // When force=true, always call renderer.handleResize to ensure all rows are updated
    // When force=false, only call it if dimensions are still stale after renderService.handleResize
    const shouldCallRendererResize =
      force || (renderService && hasStaleDimensions(readTerminalRenderDimensionsSafely(terminal)))

    if (shouldCallRendererResize) {
      renderService?._renderer?.value?.handleResize?.(terminal.cols, terminal.rows)
    }
  })
}

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
  const hasVisibleDescendantOverhang =
    hasDescendantOverhang &&
    maxDescendantRight !== null &&
    maxDescendantRight > screenRight + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX
  const textToScrollbarGapPx =
    scrollbarLeft === null || !hasVisibleTextOverhang ? null : scrollbarLeft - visualRight
  const glyphToScrollbarGapPx =
    scrollbarLeft === null || !hasVisibleDescendantOverhang
      ? null
      : scrollbarLeft - maxDescendantRight
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

export function hasDomRendererVisualFootprintRisk({
  terminal,
  container,
}: {
  terminal: Terminal
  container: HTMLElement
}): boolean {
  if (container.dataset?.coveTerminalRenderer !== 'dom') {
    return false
  }

  const cellWidth = readTerminalRenderDimensionsSafely(terminal)?.css?.cell?.width
  if (typeof cellWidth !== 'number' || !Number.isFinite(cellWidth) || cellWidth <= 0) {
    return false
  }

  if (terminal.cols <= 0) {
    return false
  }

  const footprint = getDomRendererTextFootprint(container)
  if (!footprint) {
    return false
  }

  const expectedCurrentTextWidth = terminal.cols * cellWidth
  const hasVisibleTextOverhang =
    footprint.contentWidth > expectedCurrentTextWidth + DOM_RENDERER_TEXT_OVERHANG_EPSILON_PX
  return (
    hasVisibleTextOverhang ||
    footprint.textToScrollbarGapPx !== null ||
    footprint.glyphToScrollbarGapPx !== null
  )
}
