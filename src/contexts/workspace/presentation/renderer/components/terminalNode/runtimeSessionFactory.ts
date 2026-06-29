import type { TerminalDiagnosticsLogInput, TerminalWindowsPty } from '@shared/contracts/dto'
import { createMountedXtermSession, type XtermSession } from './xtermSession'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import type { TerminalRuntimeSessionOptions } from './useTerminalRuntimeSession.types'

export function createOrReuseRuntimeXtermSession({
  options,
  initialDimensions,
  diagnosticsEnabled,
  logTerminalDiagnostics,
  windowsPty,
  preservedSession,
  canReusePreservedSession,
}: {
  options: Pick<
    TerminalRuntimeSessionOptions,
    | 'nodeId'
    | 'sessionId'
    | 'kind'
    | 'terminalProvider'
    | 'terminalThemeMode'
    | 'isTestEnvironment'
    | 'containerRef'
    | 'titleRef'
    | 'bindSearchAddonToFind'
    | 'syncTerminalSize'
    | 'terminalFontSize'
    | 'terminalFontFamily'
    | 'displayTerminalMetricsRef'
    | 'viewportZoomRef'
    | 'preferredRendererMode'
    | 'requestTerminalRendererRecovery'
    | 'scheduleWebglCanvasTransformCleanup'
    | 'scheduleTranscriptSync'
    | 'isLiveSessionReattach'
  >
  initialDimensions: { cols: number; rows: number } | null
  diagnosticsEnabled: boolean
  logTerminalDiagnostics: (payload: TerminalDiagnosticsLogInput) => void
  windowsPty: TerminalWindowsPty | null
  preservedSession: XtermSession | null
  canReusePreservedSession: boolean
}): XtermSession {
  const {
    nodeId,
    sessionId,
    kind,
    terminalProvider,
    terminalThemeMode,
    isTestEnvironment,
    containerRef,
    titleRef,
    bindSearchAddonToFind,
    syncTerminalSize,
    terminalFontSize,
    terminalFontFamily,
    displayTerminalMetricsRef,
    viewportZoomRef,
    preferredRendererMode,
    requestTerminalRendererRecovery,
    scheduleWebglCanvasTransformCleanup,
    scheduleTranscriptSync,
    isLiveSessionReattach,
  } = options

  const reusedSession = canReusePreservedSession ? preservedSession : null
  if (reusedSession) {
    reusedSession.terminal.options.disableStdin = false
    reusedSession.terminal.options.cursorBlink = true
    reusedSession.diagnostics.dispose()
    reusedSession.diagnostics = registerTerminalDiagnostics({
      enabled: diagnosticsEnabled,
      emit: logTerminalDiagnostics,
      nodeId,
      sessionId,
      nodeKind: kind === 'agent' ? 'agent' : 'terminal',
      title: titleRef.current,
      terminal: reusedSession.terminal,
      container: containerRef.current,
      rendererKind: reusedSession.renderer.kind,
      terminalThemeMode,
      windowsPty,
    })
    reusedSession.renderer.clearTextureAtlas()
    syncTerminalSize()
    scheduleTranscriptSync()
    return reusedSession
  }

  if (preservedSession) {
    preservedSession.dispose()
  }

  const displayTerminalMetrics = displayTerminalMetricsRef.current
  if (diagnosticsEnabled) {
    const rect = containerRef.current?.getBoundingClientRect()
    logTerminalDiagnostics({
      source: 'renderer-terminal',
      nodeId,
      sessionId,
      nodeKind: kind === 'agent' ? 'agent' : 'terminal',
      title: titleRef.current,
      event: 'xterm-session-create-request',
      snapshot: {
        bufferKind: 'unknown',
        activeBaseY: null,
        activeViewportY: null,
        activeLength: null,
        cols: initialDimensions?.cols ?? 0,
        rows: initialDimensions?.rows ?? 0,
        viewportScrollTop: null,
        viewportScrollHeight: null,
        viewportClientHeight: null,
        hasViewport: false,
        hasVerticalScrollbar: false,
        containerRectWidth: rect?.width ?? null,
        containerRectHeight: rect?.height ?? null,
      },
      details: {
        initialCols: initialDimensions?.cols ?? null,
        initialRows: initialDimensions?.rows ?? null,
        terminalFontSize,
        displayFontSize: displayTerminalMetrics.fontSize,
        displayLineHeight: displayTerminalMetrics.lineHeight,
        displayLetterSpacing: displayTerminalMetrics.letterSpacing ?? null,
        isLiveSessionReattach,
        canReusePreservedSession,
      },
    })
  }

  return createMountedXtermSession({
    nodeId,
    ownerId: `${nodeId}:${sessionId}`,
    sessionIdForDiagnostics: sessionId,
    nodeKindForDiagnostics: kind === 'agent' ? 'agent' : 'terminal',
    titleForDiagnostics: titleRef.current,
    terminalProvider,
    terminalThemeMode,
    isTestEnvironment,
    container: containerRef.current,
    initialDimensions,
    windowsPty,
    cursorBlink: true,
    disableStdin: false,
    fontSize: displayTerminalMetrics.fontSize,
    fontFamily: terminalFontFamily,
    lineHeight: displayTerminalMetrics.lineHeight,
    letterSpacing: displayTerminalMetrics.letterSpacing,
    bindSearchAddonToFind,
    syncTerminalSize,
    diagnosticsEnabled,
    logTerminalDiagnostics,
    initialViewportZoom: viewportZoomRef.current,
    preferredRendererMode,
    onRendererIssue: issue => {
      requestTerminalRendererRecovery({
        ...issue,
        trigger: 'context_loss',
      })
    },
    scheduleWebglCanvasTransformCleanup,
  })
}
