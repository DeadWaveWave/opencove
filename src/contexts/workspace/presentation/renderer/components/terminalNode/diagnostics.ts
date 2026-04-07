import type {
  TerminalDiagnosticsBufferKind,
  TerminalDiagnosticsDetailValue,
  TerminalDiagnosticsLogInput,
  TerminalDiagnosticsSnapshot,
} from '@shared/contracts/dto'

interface TerminalBufferStateLike {
  baseY?: number
  viewportY?: number
  length?: number
}

interface TerminalBufferNamespaceLike {
  active?: TerminalBufferStateLike
  normal?: TerminalBufferStateLike
  alternate?: TerminalBufferStateLike
}

interface TerminalForDiagnosticsLike {
  cols: number
  rows: number
  buffer?: TerminalBufferNamespaceLike
}

interface TerminalDiagnosticElements {
  xtermElement: HTMLElement | null
  viewportElement: HTMLElement | null
  screenElement: HTMLElement | null
  canvasElement: HTMLCanvasElement | null
  reactFlowNode: HTMLElement | null
  terminalNode: HTMLElement | null
  workspaceCanvas: HTMLElement | null
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toNonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function getComputedCursor(element: Element | null): string | null {
  if (!(element instanceof Element)) {
    return null
  }

  return toNonEmptyString(window.getComputedStyle(element).cursor)
}

function describeElement(element: Element | null): string | null {
  if (!(element instanceof Element)) {
    return null
  }

  const tagName = element.tagName.toLowerCase()
  const className =
    typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.')
      : ''

  return className.length > 0 ? `${tagName}.${className}` : tagName
}

function roundDiagnosticNumber(value: number): number {
  return Math.round(value * 1000) / 1000
}

function resolveTerminalDiagnosticElements(
  container: HTMLElement | null,
): TerminalDiagnosticElements {
  const xtermElement =
    container?.querySelector('.xterm') instanceof HTMLElement
      ? (container.querySelector('.xterm') as HTMLElement)
      : null
  const viewportElement =
    container?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (container.querySelector('.xterm-viewport') as HTMLElement)
      : null
  const screenElement =
    container?.querySelector('.xterm-screen') instanceof HTMLElement
      ? (container.querySelector('.xterm-screen') as HTMLElement)
      : null
  const canvasElement =
    screenElement?.querySelector('canvas') instanceof HTMLCanvasElement
      ? (screenElement.querySelector('canvas') as HTMLCanvasElement)
      : null
  const reactFlowNode =
    container?.closest('.react-flow__node') instanceof HTMLElement
      ? (container.closest('.react-flow__node') as HTMLElement)
      : null
  const terminalNode =
    container?.closest('.terminal-node') instanceof HTMLElement
      ? (container.closest('.terminal-node') as HTMLElement)
      : null
  const workspaceCanvas =
    container?.closest('.workspace-canvas') instanceof HTMLElement
      ? (container.closest('.workspace-canvas') as HTMLElement)
      : null

  return {
    xtermElement,
    viewportElement,
    screenElement,
    canvasElement,
    reactFlowNode,
    terminalNode,
    workspaceCanvas,
  }
}

function resolveDevicePixelOffset(
  value: number | null,
  devicePixelRatio: number | null,
): number | null {
  if (value === null || devicePixelRatio === null || devicePixelRatio <= 0) {
    return null
  }

  const devicePixelValue = value * devicePixelRatio
  const fractionalOffset = devicePixelValue - Math.round(devicePixelValue)
  return roundDiagnosticNumber(Math.abs(fractionalOffset))
}

export function captureTerminalInteractionDetails({
  container,
  rendererKind,
  point,
}: {
  container: HTMLElement | null
  rendererKind?: 'webgl' | 'dom' | null
  point?: { x: number; y: number } | null
}): Record<string, TerminalDiagnosticsDetailValue> {
  const {
    xtermElement,
    viewportElement,
    screenElement,
    canvasElement,
    reactFlowNode,
    terminalNode,
    workspaceCanvas,
  } = resolveTerminalDiagnosticElements(container)
  const hitTarget =
    point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? document.elementFromPoint(point.x, point.y)
      : null

  const dragSurfaceSelectionMode = workspaceCanvas?.dataset.coveDragSurfaceSelectionMode === 'true'
  const reactFlowNodeSelected = reactFlowNode?.classList.contains('selected') ?? false
  const selectedSurfaceActive = dragSurfaceSelectionMode && reactFlowNodeSelected

  return {
    rendererKind: rendererKind ?? null,
    xtermClassName: toNonEmptyString(xtermElement?.className),
    reactFlowNodeClassName: toNonEmptyString(reactFlowNode?.className),
    terminalNodeClassName: toNonEmptyString(terminalNode?.className),
    dragSurfaceSelectionMode,
    reactFlowNodeSelected,
    selectedSurfaceActive,
    xtermMouseEventsEnabled: xtermElement?.classList.contains('enable-mouse-events') ?? false,
    xtermCursorPointer: xtermElement?.classList.contains('xterm-cursor-pointer') ?? false,
    xtermCursor: getComputedCursor(xtermElement),
    viewportCursor: getComputedCursor(viewportElement),
    screenCursor: getComputedCursor(screenElement),
    canvasCursor: getComputedCursor(canvasElement),
    hitTarget: describeElement(hitTarget),
    hitTargetCursor: getComputedCursor(hitTarget),
    hitTargetInsideTerminal: hitTarget?.closest('.terminal-node__terminal') !== null,
    hitTargetInsideViewport: hitTarget?.closest('.xterm-viewport') !== null,
    hitTargetInsideScreen: hitTarget?.closest('.xterm-screen') !== null,
    hitTargetInsideSelectedOverlay:
      hitTarget instanceof Element &&
      hitTarget.closest('.react-flow__node.selected') !== null &&
      selectedSurfaceActive,
  }
}

export function captureTerminalRenderSurfaceDetails({
  container,
  rendererKind,
}: {
  container: HTMLElement | null
  rendererKind?: 'webgl' | 'dom' | null
}): Record<string, TerminalDiagnosticsDetailValue> {
  const { screenElement, canvasElement } = resolveTerminalDiagnosticElements(container)
  const devicePixelRatio =
    typeof window !== 'undefined' ? toFiniteNumber(window.devicePixelRatio) : null
  const screenRect = screenElement?.getBoundingClientRect() ?? null
  const canvasRect = canvasElement?.getBoundingClientRect() ?? null
  const canvasCssWidth = canvasRect ? roundDiagnosticNumber(canvasRect.width) : null
  const canvasCssHeight = canvasRect ? roundDiagnosticNumber(canvasRect.height) : null
  const canvasCssX = canvasRect ? roundDiagnosticNumber(canvasRect.x) : null
  const canvasCssY = canvasRect ? roundDiagnosticNumber(canvasRect.y) : null
  const canvasExpectedBitmapWidth =
    canvasCssWidth !== null && devicePixelRatio !== null
      ? Math.round(canvasCssWidth * devicePixelRatio)
      : null
  const canvasExpectedBitmapHeight =
    canvasCssHeight !== null && devicePixelRatio !== null
      ? Math.round(canvasCssHeight * devicePixelRatio)
      : null
  const canvasBitmapWidth = toFiniteNumber(canvasElement?.width)
  const canvasBitmapHeight = toFiniteNumber(canvasElement?.height)
  const canvasDevicePixelOffsetX = resolveDevicePixelOffset(canvasCssX, devicePixelRatio)
  const canvasDevicePixelOffsetY = resolveDevicePixelOffset(canvasCssY, devicePixelRatio)

  return {
    rendererKind: rendererKind ?? null,
    windowDevicePixelRatio: devicePixelRatio,
    screenCssX: screenRect ? roundDiagnosticNumber(screenRect.x) : null,
    screenCssY: screenRect ? roundDiagnosticNumber(screenRect.y) : null,
    screenCssWidth: screenRect ? roundDiagnosticNumber(screenRect.width) : null,
    screenCssHeight: screenRect ? roundDiagnosticNumber(screenRect.height) : null,
    canvasCssX,
    canvasCssY,
    canvasCssWidth,
    canvasCssHeight,
    canvasBitmapWidth,
    canvasBitmapHeight,
    canvasExpectedBitmapWidth,
    canvasExpectedBitmapHeight,
    canvasBitmapWidthDelta:
      canvasBitmapWidth !== null && canvasExpectedBitmapWidth !== null
        ? roundDiagnosticNumber(canvasBitmapWidth - canvasExpectedBitmapWidth)
        : null,
    canvasBitmapHeightDelta:
      canvasBitmapHeight !== null && canvasExpectedBitmapHeight !== null
        ? roundDiagnosticNumber(canvasBitmapHeight - canvasExpectedBitmapHeight)
        : null,
    canvasDevicePixelOffsetX,
    canvasDevicePixelOffsetY,
    canvasSubpixelOffsetDetected:
      (canvasDevicePixelOffsetX !== null && canvasDevicePixelOffsetX > 0.001) ||
      (canvasDevicePixelOffsetY !== null && canvasDevicePixelOffsetY > 0.001),
  }
}

export function resolveTerminalBufferKind(
  terminal: Pick<TerminalForDiagnosticsLike, 'buffer'>,
): TerminalDiagnosticsBufferKind {
  const buffer = terminal.buffer
  if (!buffer?.active) {
    return 'unknown'
  }

  if (buffer.alternate && buffer.active === buffer.alternate) {
    return 'alternate'
  }

  if (buffer.normal && buffer.active === buffer.normal) {
    return 'normal'
  }

  return 'unknown'
}

export function captureTerminalDiagnosticsSnapshot(
  terminal: TerminalForDiagnosticsLike,
  viewportElement: HTMLElement | null,
): TerminalDiagnosticsSnapshot {
  const activeBuffer = terminal.buffer?.active
  const scrollbar =
    viewportElement?.parentElement?.querySelector(
      '.xterm-scrollable-element .scrollbar.vertical',
    ) ?? null

  return {
    bufferKind: resolveTerminalBufferKind(terminal),
    activeBaseY: toFiniteNumber(activeBuffer?.baseY),
    activeViewportY: toFiniteNumber(activeBuffer?.viewportY),
    activeLength: toFiniteNumber(activeBuffer?.length),
    cols: terminal.cols,
    rows: terminal.rows,
    viewportScrollTop: toFiniteNumber(viewportElement?.scrollTop),
    viewportScrollHeight: toFiniteNumber(viewportElement?.scrollHeight),
    viewportClientHeight: toFiniteNumber(viewportElement?.clientHeight),
    hasViewport: viewportElement instanceof HTMLElement,
    hasVerticalScrollbar: scrollbar instanceof HTMLElement,
  }
}

export function createTerminalDiagnosticsLogger({
  enabled,
  emit,
  base,
}: {
  enabled: boolean
  emit: (payload: TerminalDiagnosticsLogInput) => void
  base: Omit<TerminalDiagnosticsLogInput, 'event' | 'snapshot' | 'details'>
}): {
  log: (
    event: string,
    snapshot: TerminalDiagnosticsSnapshot,
    details?: TerminalDiagnosticsLogInput['details'],
  ) => void
} {
  return {
    log: (event, snapshot, details) => {
      if (!enabled) {
        return
      }

      emit({
        ...base,
        event,
        snapshot,
        ...(details ? { details } : {}),
      })
    },
  }
}
