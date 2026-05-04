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
  offsetFromBottom: number | null
  wasAtBottom: boolean | null
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
    offsetFromBottom:
      typeof activeBuffer?.baseY === 'number' &&
      Number.isFinite(activeBuffer.baseY) &&
      typeof activeBuffer?.viewportY === 'number' &&
      Number.isFinite(activeBuffer.viewportY)
        ? Math.max(0, activeBuffer.baseY - activeBuffer.viewportY)
        : null,
    wasAtBottom:
      typeof activeBuffer?.baseY === 'number' &&
      Number.isFinite(activeBuffer.baseY) &&
      typeof activeBuffer?.viewportY === 'number' &&
      Number.isFinite(activeBuffer.viewportY)
        ? activeBuffer.viewportY >= activeBuffer.baseY
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

  const currentBaseY =
    typeof terminal.buffer?.active?.baseY === 'number' &&
    Number.isFinite(terminal.buffer.active.baseY)
      ? terminal.buffer.active.baseY
      : snapshot.baseY
  const resolvedViewportY = (() => {
    if (typeof currentBaseY === 'number' && Number.isFinite(currentBaseY)) {
      if (snapshot.wasAtBottom === true) {
        return currentBaseY
      }

      if (
        typeof snapshot.offsetFromBottom === 'number' &&
        Number.isFinite(snapshot.offsetFromBottom)
      ) {
        return Math.max(0, currentBaseY - snapshot.offsetFromBottom)
      }

      return Math.min(Math.max(0, snapshot.viewportY), currentBaseY)
    }

    return Math.max(0, snapshot.viewportY)
  })()
  const nextIsUserScrolling =
    typeof snapshot.isUserScrolling === 'boolean'
      ? snapshot.isUserScrolling
      : typeof currentBaseY === 'number' && Number.isFinite(currentBaseY)
        ? resolvedViewportY < currentBaseY
        : null

  if (typeof nextIsUserScrolling === 'boolean' && terminalCore._core?._bufferService) {
    terminalCore._core._bufferService.isUserScrolling = nextIsUserScrolling
  }
  if (terminalCore._core?._bufferService?.buffer) {
    terminalCore._core._bufferService.buffer.ydisp = resolvedViewportY
  }

  terminalCore._core?._viewport?.queueSync?.(resolvedViewportY)
  terminalCore._core?._viewport?.scrollToLine?.(resolvedViewportY, true)
  terminal.scrollToLine(resolvedViewportY)
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
  void viewportZoom

  return normalizePositiveNumber(baseDevicePixelRatio, 1)
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
    appliedEffectiveDpr = nextEffectiveDpr
    fireDprChange(appliedEffectiveDpr)
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
