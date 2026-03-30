import type { TerminalWindowsPty, TerminalDiagnosticsLogInput } from '@shared/contracts/dto'
import type { Terminal } from '@xterm/xterm'
import type { TerminalThemeMode } from './theme'
import { captureTerminalDiagnosticsSnapshot, createTerminalDiagnosticsLogger } from './diagnostics'

export function registerTerminalDiagnostics({
  enabled,
  emit,
  nodeId,
  sessionId,
  nodeKind,
  title,
  terminal,
  container,
  terminalThemeMode,
  windowsPty,
}: {
  enabled: boolean
  emit: (payload: TerminalDiagnosticsLogInput) => void
  nodeId: string
  sessionId: string
  nodeKind: 'terminal' | 'agent'
  title: string
  terminal: Terminal
  container: HTMLDivElement | null
  terminalThemeMode: TerminalThemeMode
  windowsPty: TerminalWindowsPty | null
}): {
  logHydrated: (details: { rawSnapshotLength: number; bufferedExitCode: number | null }) => void
  dispose: () => void
} {
  const viewportElement =
    container?.querySelector('.xterm-viewport') instanceof HTMLElement
      ? (container.querySelector('.xterm-viewport') as HTMLElement)
      : null
  const diagnostics = createTerminalDiagnosticsLogger({
    enabled,
    emit,
    base: {
      source: 'renderer-terminal',
      nodeId,
      sessionId,
      nodeKind,
      title,
    },
  })

  diagnostics.log('init', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
    windowsPtyBackend: windowsPty?.backend ?? null,
    windowsPtyBuild: windowsPty?.buildNumber ?? null,
    terminalThemeMode,
  })

  const resizeDisposable =
    typeof (terminal as unknown as { onResize?: unknown }).onResize === 'function'
      ? (
          terminal as unknown as {
            onResize: (listener: (size: { cols: number; rows: number }) => void) => {
              dispose: () => void
            }
          }
        ).onResize(size => {
          diagnostics.log('resize', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
            cols: size.cols,
            rows: size.rows,
          })
        })
      : { dispose: () => undefined }

  const handleViewportWheel = (event: WheelEvent): void => {
    diagnostics.log('wheel', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
    })
  }

  const handleViewportScroll = (): void => {
    diagnostics.log('scroll', captureTerminalDiagnosticsSnapshot(terminal, viewportElement))
  }

  viewportElement?.addEventListener('wheel', handleViewportWheel, { passive: true })
  viewportElement?.addEventListener('scroll', handleViewportScroll, { passive: true })

  return {
    logHydrated: ({ rawSnapshotLength, bufferedExitCode }) => {
      diagnostics.log('hydrated', captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
        rawSnapshotLength,
        bufferedExitCode,
      })
    },
    dispose: () => {
      resizeDisposable.dispose()
      viewportElement?.removeEventListener('wheel', handleViewportWheel)
      viewportElement?.removeEventListener('scroll', handleViewportScroll)
    },
  }
}
