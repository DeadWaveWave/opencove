export type TerminalRenderMetricsTestProjection = {
  rendererConstructorName: string | null
  renderRowCount: number | null
  renderServicePaused: boolean | null
  renderServiceNeedsFullRefresh: boolean | null
  effectiveDpr: number | null
  deviceCanvasWidth: number | null
  deviceCanvasHeight: number | null
  cssCanvasWidth: number | null
  cssCanvasHeight: number | null
  cssCellWidth: number | null
  cssCellHeight: number | null
  baseY: number | null
  viewportY: number | null
  isUserScrolling: boolean | null
  dprDecision: string | null
  hookAtBottom: boolean | null
  hookViewportY: number | null
  hookBaseY: number | null
  instanceId: number | null
}

export type TerminalRendererDprTestProjection = {
  devicePixelRatio: number
  rasterScale: number
}

type TerminalRenderIntrospection = {
  buffer?: { active?: { baseY?: unknown; viewportY?: unknown } }
  _core?: {
    _bufferService?: { isUserScrolling?: unknown }
    _coreBrowserService?: { dpr?: unknown }
    _renderService?: {
      _isPaused?: unknown
      _needsFullRefresh?: unknown
      _rowCount?: unknown
      dimensions?: {
        device?: { canvas?: { width?: number; height?: number } }
        css?: {
          canvas?: { width?: number; height?: number }
          cell?: { width?: number; height?: number }
        }
      }
      _renderer?: {
        value?: {
          constructor?: { name?: unknown }
          _coreBrowserService?: Record<string, unknown>
          _devicePixelRatio?: unknown
          _rasterScale?: unknown
          handleDevicePixelRatioChange?: () => void
        }
      }
    }
  }
  __opencoveDprDebug?: {
    lastDecision?: unknown
    hookAtBottom?: unknown
    hookViewportY?: unknown
    hookBaseY?: unknown
  }
  __opencoveXtermSessionInstanceId?: number
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readTerminalRenderMetricsForTest(
  value: unknown,
): TerminalRenderMetricsTestProjection | null {
  const terminal = value as TerminalRenderIntrospection | undefined
  const renderService = terminal?._core?._renderService
  const dimensions = renderService?.dimensions
  if (!terminal || !dimensions) {
    return null
  }

  const deviceCanvas = dimensions.device?.canvas
  const cssCanvas = dimensions.css?.canvas
  const cssCell = dimensions.css?.cell
  const dprDebug = terminal.__opencoveDprDebug
  const rendererConstructorName = renderService?._renderer?.value?.constructor?.name
  return {
    rendererConstructorName:
      typeof rendererConstructorName === 'string' ? rendererConstructorName : null,
    renderRowCount: finiteNumberOrNull(renderService?._rowCount),
    renderServicePaused:
      typeof renderService?._isPaused === 'boolean' ? renderService._isPaused : null,
    renderServiceNeedsFullRefresh:
      typeof renderService?._needsFullRefresh === 'boolean'
        ? renderService._needsFullRefresh
        : null,
    effectiveDpr: finiteNumberOrNull(terminal._core?._coreBrowserService?.dpr),
    deviceCanvasWidth: finiteNumberOrNull(deviceCanvas?.width),
    deviceCanvasHeight: finiteNumberOrNull(deviceCanvas?.height),
    cssCanvasWidth: finiteNumberOrNull(cssCanvas?.width),
    cssCanvasHeight: finiteNumberOrNull(cssCanvas?.height),
    cssCellWidth: finiteNumberOrNull(cssCell?.width),
    cssCellHeight: finiteNumberOrNull(cssCell?.height),
    baseY: finiteNumberOrNull(terminal.buffer?.active?.baseY),
    viewportY: finiteNumberOrNull(terminal.buffer?.active?.viewportY),
    isUserScrolling:
      typeof terminal._core?._bufferService?.isUserScrolling === 'boolean'
        ? terminal._core._bufferService.isUserScrolling
        : null,
    dprDecision: typeof dprDebug?.lastDecision === 'string' ? dprDebug.lastDecision : null,
    hookAtBottom: typeof dprDebug?.hookAtBottom === 'boolean' ? dprDebug.hookAtBottom : null,
    hookViewportY: finiteNumberOrNull(dprDebug?.hookViewportY),
    hookBaseY: finiteNumberOrNull(dprDebug?.hookBaseY),
    instanceId: finiteNumberOrNull(terminal.__opencoveXtermSessionInstanceId),
  }
}

export function simulateRendererDevicePixelRatioChangeForTest(
  value: unknown,
  nextDpr: number,
): TerminalRendererDprTestProjection | null {
  const terminal = value as TerminalRenderIntrospection | undefined
  const renderer = terminal?._core?._renderService?._renderer?.value
  const browserService = renderer?._coreBrowserService
  if (
    !renderer ||
    !browserService ||
    typeof renderer.handleDevicePixelRatioChange !== 'function' ||
    !Number.isFinite(nextDpr) ||
    nextDpr <= 0
  ) {
    return null
  }

  const originalDprDescriptor = Object.getOwnPropertyDescriptor(browserService, 'dpr')
  try {
    Object.defineProperty(browserService, 'dpr', {
      configurable: true,
      value: nextDpr,
    })
    renderer.handleDevicePixelRatioChange()
    const devicePixelRatio = finiteNumberOrNull(renderer._devicePixelRatio)
    const rasterScale = finiteNumberOrNull(renderer._rasterScale)
    return devicePixelRatio === null || rasterScale === null
      ? null
      : { devicePixelRatio, rasterScale }
  } finally {
    if (originalDprDescriptor) {
      Object.defineProperty(browserService, 'dpr', originalDprDescriptor)
    } else {
      delete browserService.dpr
    }
    renderer.handleDevicePixelRatioChange()
  }
}
