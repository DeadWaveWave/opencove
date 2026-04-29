import type { Terminal } from '@xterm/xterm'

type TerminalEffectiveDprController = {
  dispose: () => void
  setViewportZoom: (_viewportZoom: number) => void
  setViewportInteractionActive: (_active: boolean) => void
}

type InternalCoreBrowserService = Record<string, unknown> & {
  _onDprChange?: { fire?: (value: number) => void }
}

type InternalRenderService = {
  handleDevicePixelRatioChange?: () => void
}

type InternalTerminal = Terminal & {
  _core?: {
    _coreBrowserService?: InternalCoreBrowserService
    _renderService?: InternalRenderService
  }
  __opencoveDprDebug?: {
    lastInputZoom?: number | null
    lastDecision?: string | null
    appliedDpr?: number | null
  }
}

const terminalEffectiveDprControllers = new WeakMap<Terminal, TerminalEffectiveDprController>()
const DPR_EPSILON = 0.001

type TerminalCssGeometrySnapshot = {
  canvasWidth: number | null
  canvasHeight: number | null
  cellWidth: number | null
  cellHeight: number | null
  screenWidthStyle: string | null
  screenHeightStyle: string | null
  viewportWidthStyle: string | null
  viewportHeightStyle: string | null
  canvasStyleSizes: Array<{
    element: HTMLCanvasElement
    width: string
    height: string
  }>
}

function normalizePositiveNumber(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function resolveTerminalWindow(terminal: Terminal): Window | null {
  return terminal.element?.ownerDocument?.defaultView ?? window
}

function resolveBaseDevicePixelRatio(terminal: Terminal): number {
  const terminalWindow = resolveTerminalWindow(terminal)
  return normalizePositiveNumber(terminalWindow?.devicePixelRatio ?? 1, 1)
}

function areClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= DPR_EPSILON
}

export type TerminalScrollStateSnapshot = {
  baseY: number | null
  viewportY: number | null
  isUserScrolling: boolean | null
}

export function captureTerminalScrollState(terminal: Terminal): TerminalScrollStateSnapshot {
  const activeBuffer = terminal.buffer?.active
  const terminalCore = terminal as Terminal & {
    _core?: {
      _bufferService?: { isUserScrolling?: boolean; buffer?: { ydisp?: number } }
    }
  }

  return {
    viewportY:
      typeof activeBuffer?.viewportY === 'number' && Number.isFinite(activeBuffer.viewportY)
        ? activeBuffer.viewportY
        : null,
    baseY:
      typeof activeBuffer?.baseY === 'number' && Number.isFinite(activeBuffer.baseY)
        ? activeBuffer.baseY
        : null,
    isUserScrolling:
      typeof terminalCore._core?._bufferService?.isUserScrolling === 'boolean'
        ? terminalCore._core._bufferService.isUserScrolling
        : null,
  }
}

export function restoreTerminalScrollState(
  terminal: Terminal,
  snapshot: TerminalScrollStateSnapshot,
): void {
  if (snapshot.viewportY === null) {
    return
  }

  const terminalCore = terminal as Terminal & {
    _core?: {
      _bufferService?: { isUserScrolling?: boolean; buffer?: { ydisp?: number } }
      _viewport?: {
        queueSync?: (ydisp?: number) => void
        scrollToLine?: (line: number, disableSmoothScroll?: boolean) => void
      }
    }
  }

  if (typeof snapshot.isUserScrolling === 'boolean' && terminalCore._core?._bufferService) {
    terminalCore._core._bufferService.isUserScrolling = snapshot.isUserScrolling
  }
  if (terminalCore._core?._bufferService?.buffer) {
    terminalCore._core._bufferService.buffer.ydisp = snapshot.viewportY
  }

  terminalCore._core?._viewport?.queueSync?.(snapshot.viewportY)
  terminalCore._core?._viewport?.scrollToLine?.(snapshot.viewportY, true)
  terminal.scrollToLine(snapshot.viewportY)
}

function captureTerminalCssGeometry(terminal: Terminal): TerminalCssGeometrySnapshot {
  const renderDimensions = (
    terminal as Terminal & {
      _core?: {
        _renderService?: {
          dimensions?: {
            css?: {
              canvas?: { width?: number; height?: number }
              cell?: { width?: number; height?: number }
            }
          }
        }
      }
    }
  )._core?._renderService?.dimensions

  const terminalRoot =
    terminal.element && typeof terminal.element.querySelector === 'function'
      ? terminal.element
      : null
  const screenElement =
    terminalRoot?.querySelector('.xterm-screen') instanceof HTMLElement
      ? (terminalRoot.querySelector('.xterm-screen') as HTMLElement)
      : null
  const viewportElement =
    terminalRoot?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (terminalRoot.querySelector('.xterm-viewport') as HTMLElement)
      : null
  const canvasStyleSizes =
    screenElement?.querySelectorAll('canvas') instanceof NodeList
      ? Array.from(screenElement.querySelectorAll('canvas')).filter(
          (node): node is HTMLCanvasElement => node instanceof HTMLCanvasElement,
        )
      : []

  return {
    canvasWidth:
      typeof renderDimensions?.css?.canvas?.width === 'number' &&
      Number.isFinite(renderDimensions.css.canvas.width)
        ? renderDimensions.css.canvas.width
        : null,
    canvasHeight:
      typeof renderDimensions?.css?.canvas?.height === 'number' &&
      Number.isFinite(renderDimensions.css.canvas.height)
        ? renderDimensions.css.canvas.height
        : null,
    cellWidth:
      typeof renderDimensions?.css?.cell?.width === 'number' &&
      Number.isFinite(renderDimensions.css.cell.width)
        ? renderDimensions.css.cell.width
        : null,
    cellHeight:
      typeof renderDimensions?.css?.cell?.height === 'number' &&
      Number.isFinite(renderDimensions.css.cell.height)
        ? renderDimensions.css.cell.height
        : null,
    screenWidthStyle: screenElement?.style.width ?? null,
    screenHeightStyle: screenElement?.style.height ?? null,
    viewportWidthStyle: viewportElement?.style.width ?? null,
    viewportHeightStyle: viewportElement?.style.height ?? null,
    canvasStyleSizes: canvasStyleSizes.map(element => ({
      element,
      width: element.style.width,
      height: element.style.height,
    })),
  }
}

function restoreTerminalCssGeometry(
  terminal: Terminal,
  snapshot: TerminalCssGeometrySnapshot,
): void {
  const renderDimensions = (
    terminal as Terminal & {
      _core?: {
        _renderService?: {
          dimensions?: {
            css?: {
              canvas?: { width?: number; height?: number }
              cell?: { width?: number; height?: number }
            }
          }
        }
      }
    }
  )._core?._renderService?.dimensions

  if (snapshot.canvasWidth !== null && renderDimensions?.css?.canvas) {
    renderDimensions.css.canvas.width = snapshot.canvasWidth
  }
  if (snapshot.canvasHeight !== null && renderDimensions?.css?.canvas) {
    renderDimensions.css.canvas.height = snapshot.canvasHeight
  }
  if (snapshot.cellWidth !== null && renderDimensions?.css?.cell) {
    renderDimensions.css.cell.width = snapshot.cellWidth
  }
  if (snapshot.cellHeight !== null && renderDimensions?.css?.cell) {
    renderDimensions.css.cell.height = snapshot.cellHeight
  }

  const terminalRoot =
    terminal.element && typeof terminal.element.querySelector === 'function'
      ? terminal.element
      : null
  const screenElement =
    terminalRoot?.querySelector('.xterm-screen') instanceof HTMLElement
      ? (terminalRoot.querySelector('.xterm-screen') as HTMLElement)
      : null
  const viewportElement =
    terminalRoot?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (terminalRoot.querySelector('.xterm-viewport') as HTMLElement)
      : null

  if (screenElement && snapshot.screenWidthStyle !== null) {
    screenElement.style.width = snapshot.screenWidthStyle
  }
  if (screenElement && snapshot.screenHeightStyle !== null) {
    screenElement.style.height = snapshot.screenHeightStyle
  }
  if (viewportElement && snapshot.viewportWidthStyle !== null) {
    viewportElement.style.width = snapshot.viewportWidthStyle
  }
  if (viewportElement && snapshot.viewportHeightStyle !== null) {
    viewportElement.style.height = snapshot.viewportHeightStyle
  }
  for (const canvasSnapshot of snapshot.canvasStyleSizes) {
    if (!canvasSnapshot.element.isConnected) {
      continue
    }
    canvasSnapshot.element.style.width = canvasSnapshot.width
    canvasSnapshot.element.style.height = canvasSnapshot.height
  }
}

function updateTerminalDprDebug(
  terminal: InternalTerminal,
  debug: Partial<NonNullable<InternalTerminal['__opencoveDprDebug']>>,
): void {
  terminal.__opencoveDprDebug = {
    ...(terminal.__opencoveDprDebug ?? {}),
    ...debug,
  }
}

export function resolveTerminalEffectiveDevicePixelRatio({
  baseDevicePixelRatio,
  viewportZoom,
}: {
  baseDevicePixelRatio: number
  viewportZoom: number
}): number {
  const resolvedBaseDevicePixelRatio = normalizePositiveNumber(baseDevicePixelRatio, 1)
  const resolvedViewportZoom = normalizePositiveNumber(viewportZoom, 1)

  return resolvedViewportZoom > 1
    ? resolvedBaseDevicePixelRatio * resolvedViewportZoom
    : resolvedBaseDevicePixelRatio
}

export function installTerminalEffectiveDevicePixelRatioController({
  terminal,
  initialViewportZoom,
  initialViewportInteractionActive = false,
  onAfterApply,
}: {
  terminal: Terminal
  initialViewportZoom: number
  initialViewportInteractionActive?: boolean
  onAfterApply?: () => void
}): TerminalEffectiveDprController {
  const internalTerminal = terminal as InternalTerminal
  const coreBrowserService = internalTerminal._core?._coreBrowserService
  const renderService = internalTerminal._core?._renderService

  const noopController: TerminalEffectiveDprController = {
    dispose: () => undefined,
    setViewportZoom: () => undefined,
    setViewportInteractionActive: () => undefined,
  }

  if (!coreBrowserService || typeof renderService?.handleDevicePixelRatioChange !== 'function') {
    terminalEffectiveDprControllers.set(terminal, noopController)
    updateTerminalDprDebug(internalTerminal, {
      lastDecision: 'noop:missing-render-path',
      appliedDpr: resolveBaseDevicePixelRatio(terminal),
    })
    return noopController
  }

  const hadOwnDprDescriptor = Object.prototype.hasOwnProperty.call(coreBrowserService, 'dpr')
  const ownDprDescriptor = hadOwnDprDescriptor
    ? (Object.getOwnPropertyDescriptor(coreBrowserService, 'dpr') ?? null)
    : null

  let viewportZoom = normalizePositiveNumber(initialViewportZoom, 1)
  let viewportInteractionActive = initialViewportInteractionActive
  let appliedEffectiveDpr = resolveBaseDevicePixelRatio(terminal)
  let observedBaseDevicePixelRatio = appliedEffectiveDpr
  let isDisposed = false

  const fireDprChange = (nextEffectiveDpr: number): void => {
    Object.defineProperty(coreBrowserService, 'dpr', {
      configurable: true,
      get: () => nextEffectiveDpr,
    })

    const dprEmitter = coreBrowserService._onDprChange
    if (typeof dprEmitter?.fire === 'function') {
      dprEmitter.fire(nextEffectiveDpr)
      return
    }

    renderService.handleDevicePixelRatioChange?.()
  }

  const commitPendingViewportZoom = (reason: string): void => {
    if (isDisposed) {
      return
    }

    observedBaseDevicePixelRatio = resolveBaseDevicePixelRatio(terminal)
    const nextEffectiveDpr = resolveTerminalEffectiveDevicePixelRatio({
      baseDevicePixelRatio: observedBaseDevicePixelRatio,
      viewportZoom,
    })

    updateTerminalDprDebug(internalTerminal, {
      lastInputZoom: viewportZoom,
    })

    if (areClose(nextEffectiveDpr, appliedEffectiveDpr)) {
      updateTerminalDprDebug(internalTerminal, {
        lastDecision: 'noop:unchanged',
        appliedDpr: appliedEffectiveDpr,
      })
      return
    }

    const scrollState = captureTerminalScrollState(terminal)
    const cssGeometry = captureTerminalCssGeometry(terminal)
    appliedEffectiveDpr = nextEffectiveDpr
    fireDprChange(appliedEffectiveDpr)
    restoreTerminalCssGeometry(terminal, cssGeometry)
    restoreTerminalScrollState(terminal, scrollState)
    onAfterApply?.()
    updateTerminalDprDebug(internalTerminal, {
      lastDecision: `applied:${reason}`,
      appliedDpr: appliedEffectiveDpr,
    })
  }

  const handleWindowResize = (): void => {
    const nextBaseDevicePixelRatio = resolveBaseDevicePixelRatio(terminal)
    if (areClose(nextBaseDevicePixelRatio, observedBaseDevicePixelRatio)) {
      return
    }

    commitPendingViewportZoom('window-dpr')
  }

  const terminalWindow = resolveTerminalWindow(terminal)
  terminalWindow?.addEventListener('resize', handleWindowResize)

  const controller: TerminalEffectiveDprController = {
    dispose: () => {
      if (isDisposed) {
        return
      }

      isDisposed = true
      terminalWindow?.removeEventListener('resize', handleWindowResize)

      if (hadOwnDprDescriptor && ownDprDescriptor) {
        Object.defineProperty(coreBrowserService, 'dpr', ownDprDescriptor)
      } else {
        Reflect.deleteProperty(coreBrowserService, 'dpr')
      }

      terminalEffectiveDprControllers.delete(terminal)
    },
    setViewportZoom: nextViewportZoom => {
      viewportZoom = normalizePositiveNumber(nextViewportZoom, 1)
      if (!viewportInteractionActive) {
        commitPendingViewportZoom('viewport-zoom')
        return
      }

      updateTerminalDprDebug(internalTerminal, {
        lastInputZoom: viewportZoom,
        lastDecision: 'deferred:interaction-active',
      })
    },
    setViewportInteractionActive: active => {
      viewportInteractionActive = active
      if (!active) {
        commitPendingViewportZoom('viewport-settled')
      }
    },
  }

  terminalEffectiveDprControllers.set(terminal, controller)
  controller.setViewportZoom(viewportZoom)
  return controller
}

export function setTerminalViewportZoom(terminal: Terminal | null, viewportZoom: number): void {
  if (!terminal) {
    return
  }

  terminalEffectiveDprControllers.get(terminal)?.setViewportZoom(viewportZoom)
}

export function setTerminalViewportInteractionActive(
  terminal: Terminal | null,
  active: boolean,
): void {
  if (!terminal) {
    return
  }

  terminalEffectiveDprControllers.get(terminal)?.setViewportInteractionActive(active)
}
