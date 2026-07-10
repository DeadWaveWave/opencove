import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type { TerminalGeometryCommitReason } from '@shared/contracts/dto'
import {
  captureTerminalDiagnosticsSnapshot,
  captureTerminalLayoutDiagnostics,
  createTerminalDiagnosticsLogger,
} from './diagnostics'
import type { PtySize } from './terminalGeometryTypes'

function isTerminalDiagnosticsEnabled(): boolean {
  return window.opencoveApi?.meta?.enableTerminalDiagnostics === true
}

export function logTerminalGeometryDiagnostics({
  event,
  terminal,
  fitAddon,
  container,
  sessionId,
  reason,
  lastCommittedPtySize,
  measured,
  nextPtySize,
  skippedReason,
  extraDetails,
}: {
  event: string
  terminal: Terminal | null
  fitAddon: FitAddon | null
  container: HTMLElement | null
  sessionId: string | null
  reason?: TerminalGeometryCommitReason | null
  lastCommittedPtySize?: PtySize | null
  measured?: PtySize | null
  nextPtySize?: PtySize | null
  skippedReason?: string | null
  extraDetails?: Record<string, string | number | boolean | null>
}): void {
  if (!isTerminalDiagnosticsEnabled() || !terminal) {
    return
  }

  const logger = createTerminalDiagnosticsLogger({
    enabled: true,
    emit: window.opencoveApi?.debug?.logTerminalDiagnostics ?? (() => undefined),
    base: {
      source: 'renderer-terminal',
      nodeId: 'unknown',
      sessionId: sessionId ?? 'unknown',
      nodeKind: 'terminal',
      title: 'terminal-geometry',
    },
  })
  const viewportElement =
    container?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (container.querySelector('.xterm-viewport') as HTMLElement)
      : null
  const proposed = (() => {
    try {
      return fitAddon?.proposeDimensions() ?? null
    } catch {
      return null
    }
  })()

  logger.log(event, captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
    reason: reason ?? null,
    skippedReason: skippedReason ?? null,
    measuredCols: measured?.cols ?? null,
    measuredRows: measured?.rows ?? null,
    proposedCols: proposed?.cols ?? null,
    proposedRows: proposed?.rows ?? null,
    nextCols: nextPtySize?.cols ?? null,
    nextRows: nextPtySize?.rows ?? null,
    lastCommittedCols: lastCommittedPtySize?.cols ?? null,
    lastCommittedRows: lastCommittedPtySize?.rows ?? null,
    pointerResizing: null,
    ...captureTerminalLayoutDiagnostics({ terminal, container, proposedCols: proposed?.cols }),
    ...(extraDetails ?? {}),
  })
}
