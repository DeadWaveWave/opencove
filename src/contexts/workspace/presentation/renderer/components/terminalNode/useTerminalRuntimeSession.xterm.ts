import type { TerminalDiagnosticsLogInput, TerminalWindowsPty } from '@shared/contracts/dto'
import {
  bindMountedXtermSessionRefs,
  createMountedXtermSession,
  type XtermSession,
} from './xtermSession'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import { shouldReusePreservedXtermSession } from './useTerminalRuntimeSession.support'
import type { TerminalRuntimeSessionOptions } from './useTerminalRuntimeSession.types'

type RuntimeXtermSessionOptions = Pick<
  TerminalRuntimeSessionOptions,
  | 'nodeId'
  | 'sessionId'
  | 'kind'
  | 'terminalProvider'
  | 'titleRef'
  | 'terminalThemeMode'
  | 'isTestEnvironment'
  | 'containerRef'
  | 'terminalRef'
  | 'fitAddonRef'
  | 'preservedXtermSessionRef'
  | 'isLiveSessionReattach'
  | 'scheduleWebglCanvasTransformCleanup'
  | 'syncTerminalSize'
  | 'bindSearchAddonToFind'
  | 'terminalFontSize'
  | 'terminalFontFamily'
  | 'displayTerminalMetricsRef'
  | 'viewportZoomRef'
  | 'preferredRendererMode'
  | 'terminalClientResetVersion'
  | 'requestTerminalRendererRecovery'
> & {
  initialDimensions: { cols: number; rows: number } | null
  windowsPty: TerminalWindowsPty | null
  diagnosticsEnabled: boolean
  logTerminalDiagnostics: (payload: TerminalDiagnosticsLogInput) => void
  scheduleTranscriptSync: () => void
}

export function createOrReuseRuntimeXtermSession({
  nodeId,
  sessionId,
  kind,
  terminalProvider,
  titleRef,
  terminalThemeMode,
  isTestEnvironment,
  containerRef,
  terminalRef,
  fitAddonRef,
  preservedXtermSessionRef,
  isLiveSessionReattach,
  scheduleWebglCanvasTransformCleanup,
  syncTerminalSize,
  bindSearchAddonToFind,
  terminalFontSize,
  terminalFontFamily,
  displayTerminalMetricsRef,
  viewportZoomRef,
  preferredRendererMode,
  terminalClientResetVersion,
  requestTerminalRendererRecovery,
  initialDimensions,
  windowsPty,
  diagnosticsEnabled,
  logTerminalDiagnostics,
  scheduleTranscriptSync,
}: RuntimeXtermSessionOptions): {
  session: XtermSession
  hasPreservedVisibleBaseline: boolean
  preservedSession: XtermSession | null
} {
  const preservedSession = preservedXtermSessionRef.current
  preservedXtermSessionRef.current = null
  const canReusePreservedSession = shouldReusePreservedXtermSession({
    preservedSession,
    terminalClientResetVersion,
  })
  const hasPreservedVisibleBaseline = canReusePreservedSession && preservedSession !== null
  const nodeKindForDiagnostics = kind === 'agent' ? 'agent' : 'terminal'
  const session =
    (canReusePreservedSession ? preservedSession : null) ??
    (() => {
      const displayTerminalMetrics = displayTerminalMetricsRef.current
      if (diagnosticsEnabled) {
        const rect = containerRef.current?.getBoundingClientRect()
        logTerminalDiagnostics({
          source: 'renderer-terminal',
          nodeId,
          sessionId,
          nodeKind: nodeKindForDiagnostics,
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
        nodeKindForDiagnostics,
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
    })()
  if (preservedSession && !canReusePreservedSession) {
    preservedSession.dispose()
  }
  if (canReusePreservedSession && preservedSession) {
    session.terminal.options.disableStdin = false
    session.terminal.options.cursorBlink = true
    session.diagnostics.dispose()
    session.diagnostics = registerTerminalDiagnostics({
      enabled: diagnosticsEnabled,
      emit: logTerminalDiagnostics,
      nodeId,
      sessionId,
      nodeKind: nodeKindForDiagnostics,
      title: titleRef.current,
      terminal: session.terminal,
      container: containerRef.current,
      rendererKind: session.renderer.kind,
      terminalThemeMode,
      windowsPty,
    })
    session.renderer.clearTextureAtlas()
    syncTerminalSize()
    scheduleTranscriptSync()
  }
  bindMountedXtermSessionRefs({
    session,
    terminalRef,
    fitAddonRef,
    syncTerminalSize,
  })

  return { session, hasPreservedVisibleBaseline, preservedSession }
}
