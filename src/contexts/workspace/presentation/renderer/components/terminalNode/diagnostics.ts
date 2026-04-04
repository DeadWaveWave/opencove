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

export function captureTerminalInteractionDetails({
  container,
  rendererKind,
  point,
}: {
  container: HTMLElement | null
  rendererKind?: 'webgl' | 'dom' | null
  point?: { x: number; y: number } | null
}): Record<string, TerminalDiagnosticsDetailValue> {
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
