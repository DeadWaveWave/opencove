import type {
  TerminalDiagnosticsBufferKind,
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
