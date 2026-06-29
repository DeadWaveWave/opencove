import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import {
  readTerminalRenderDimensionsSafely,
  runTerminalRenderMutationSafely,
} from './renderServiceSafety'
import { logTerminalGeometryDiagnostics } from './terminalGeometryDiagnostics'

const DOM_RENDERER_DIMENSION_EPSILON_PX = 0.5

export function canRefreshTerminalLayout(input: {
  terminal: Terminal | null
  container: HTMLElement | null
  isPointerResizingRef: MutableRefObject<boolean>
}): boolean {
  if (!input.terminal || !input.container) {
    return false
  }

  if (input.container.clientWidth <= 2 || input.container.clientHeight <= 2) {
    return false
  }

  if (input.isPointerResizingRef.current) {
    return false
  }

  return true
}

function clampXtermHeightToExactRows(terminal: Terminal): void {
  const xtermEl = terminal.element
  if (!xtermEl) {
    return
  }

  const cellHeight = readTerminalRenderDimensionsSafely(terminal)?.css?.cell?.height
  if (typeof cellHeight !== 'number' || !Number.isFinite(cellHeight) || cellHeight <= 0) {
    return
  }

  const contentHeight = Math.floor(terminal.rows * cellHeight)
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
  xtermEl.style.height = `${exactHeight}px`
}

function syncDomRendererDimensionsToCurrentGeometry({
  terminal,
  container,
}: {
  terminal: Terminal
  container: HTMLElement | null
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

  if (!hasStaleDimensions(renderDimensions)) {
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
    if (typeof renderService?.handleResize === 'function') {
      renderService.handleResize(terminal.cols, terminal.rows)
      if (!hasStaleDimensions(readTerminalRenderDimensionsSafely(terminal))) {
        return
      }
    }

    renderService?._renderer?.value?.handleResize?.(terminal.cols, terminal.rows)
  })
}

export function refreshTerminalNodeSize({
  terminalRef,
  containerRef,
  isPointerResizingRef,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLElement | null>
  isPointerResizingRef: MutableRefObject<boolean>
}): void {
  const terminal = terminalRef.current
  const container = containerRef.current

  if (!canRefreshTerminalLayout({ terminal, container, isPointerResizingRef })) {
    logTerminalGeometryDiagnostics({
      event: 'geometry-refresh-skipped',
      terminal,
      fitAddon: null,
      container,
      sessionId: null,
      skippedReason: !terminal
        ? 'missing-terminal'
        : !container
          ? 'missing-container'
          : container.clientWidth <= 2 || container.clientHeight <= 2
            ? 'container-too-small'
            : isPointerResizingRef.current
              ? 'pointer-resizing'
              : 'unknown',
    })
    return
  }

  if (!terminal) {
    return
  }

  if (terminal.cols <= 0 || terminal.rows <= 0) {
    return
  }

  syncDomRendererDimensionsToCurrentGeometry({ terminal, container })
  clampXtermHeightToExactRows(terminal)
  runTerminalRenderMutationSafely(() => {
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  })
  logTerminalGeometryDiagnostics({
    event: 'geometry-refresh',
    terminal,
    fitAddon: null,
    container,
    sessionId: null,
  })
}
