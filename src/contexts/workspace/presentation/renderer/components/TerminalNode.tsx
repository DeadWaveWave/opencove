import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '@xyflow/react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { createTerminalCommandInputState } from './terminalNode/commandInput'
import {
  commitTerminalNodeGeometry,
  refreshTerminalNodeSize,
} from './terminalNode/syncTerminalNodeSize'
import {
  captureTerminalScrollState,
  type TerminalScrollStateSnapshot,
} from './terminalNode/effectiveDevicePixelRatio'
import { resolveTerminalNodeFrameStyle } from './terminalNode/nodeFrameStyle'
import { useTerminalAppearanceSync } from './terminalNode/useTerminalAppearanceSync'
import { useTerminalTestTranscriptMirror } from './terminalNode/useTerminalTestTranscriptMirror'
import { useTerminalThemeApplier } from './terminalNode/useTerminalThemeApplier'
import { useTerminalBodyClickFallback } from './terminalNode/useTerminalBodyClickFallback'
import { useTerminalFileDropPaste } from './terminalNode/useTerminalFileDropPaste'
import { useTerminalFind } from './terminalNode/useTerminalFind'
import { useTerminalResize } from './terminalNode/useTerminalResize'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import type { TerminalOutputScheduler } from './terminalNode/outputScheduler'
import { useTerminalRuntimeSession } from './terminalNode/useTerminalRuntimeSession'
import { useTerminalPlaceholderSession } from './terminalNode/useTerminalPlaceholderSession'
import { useWebglCanvasTransformCleanupScheduler } from './terminalNode/useWebglCanvasTransformCleanupScheduler'
import type { XtermSession } from './terminalNode/xtermSession'
import { invalidateCachedTerminalScreenState } from './terminalNode/screenStateCache'
import type { PreferredTerminalRendererMode } from './terminalNode/preferredRenderer'
import type { TerminalRendererRecoveryRequest } from './terminalNode/runtimeRendererHealth'
import {
  selectDragSurfaceSelectionMode,
  selectViewportInteractionActive,
} from './terminalNode/reactFlowState'
import { useViewportInteractionSettledState } from './terminalNode/useViewportInteractionSettledState'
import { TerminalNodeFrame } from './terminalNode/TerminalNodeFrame'
import { resolveAgentNodeMinSize, resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import type { TerminalNodeProps } from './TerminalNode.types'

export function TerminalNode({
  nodeId,
  sessionId,
  title,
  fixedTitlePrefix = null,
  kind,
  labelColor,
  terminalProvider = null,
  agentLaunchMode = null,
  agentExecutionDirectory = null,
  agentResumeSessionId = null,
  agentResumeSessionIdVerified = false,
  isLiveSessionReattach = false,
  terminalGeometry = null,
  terminalThemeMode = 'sync-with-ui',
  isSelected = false,
  isDragging = false,
  status,
  directoryMismatch,
  lastError,
  position,
  width,
  height,
  terminalFontSize,
  terminalFontFamily,
  terminalDisplayCalibration,
  scrollback,
  onClose,
  onCopyLastMessage,
  onReloadSession,
  onListSessions,
  onSwitchSession,
  onResize,
  onScrollbackChange,
  onTitleCommit,
  onCommandRun,
  onInteractionStart,
}: TerminalNodeProps): JSX.Element {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const isViewportInteractionActive = useStore(selectViewportInteractionActive)
  const isViewportInteractionSettledActive = useViewportInteractionSettledState(
    isViewportInteractionActive,
  )
  const viewportZoom = useStore(storeState => {
    const state = storeState as unknown as { transform?: [number, number, number] }
    const zoom = state.transform?.[2] ?? 1
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  })
  const isTestEnvironment =
    window.opencoveApi.meta.isTest || window.opencoveApi.meta.enableTerminalTestApi === true
  const diagnosticsEnabled = window.opencoveApi.meta?.enableTerminalDiagnostics === true
  const outputSchedulerRef = useRef<TerminalOutputScheduler | null>(null)
  const isViewportInteractionActiveRef = useRef(isViewportInteractionActive)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const shouldRestoreTerminalFocusRef = useRef(false)
  const latestSessionIdRef = useRef(sessionId)
  const preservedXtermSessionRef = useRef<XtermSession | null>(null)
  const recoveryScrollStateRef = useRef<TerminalScrollStateSnapshot | null>(null)
  const rendererRecoveryPendingRef = useRef(false)
  const rendererRecoveryStateRef = useRef<{
    sessionId: string
    preferredMode: PreferredTerminalRendererMode
    resetVersion: number
  }>({ sessionId, preferredMode: 'auto', resetVersion: 0 })
  const recentUserInteractionAtRef = useRef(0)
  const pendingUserInputBufferRef = useRef<Array<{ data: string; encoding: 'utf8' | 'binary' }>>([])
  const initialTerminalGeometryRef = useRef(terminalGeometry)
  const initialTerminalGeometryKeyRef = useRef({ sessionId, resetVersion: 0 })
  const viewportZoomRef = useRef(viewportZoom)
  const [, forceRendererRecoveryRender] = useState(0)
  const {
    activeRendererKindRef,
    scheduleWebglCanvasTransformCleanup,
    cancelWebglCanvasTransformCleanup,
    setRendererKindAndApply,
  } = useWebglCanvasTransformCleanupScheduler({ containerRef })
  const isPointerResizingRef = useRef(false)
  const lastCommittedPtySizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const suppressPtyResizeRef = useRef(false)
  const commandInputStateRef = useRef(createTerminalCommandInputState())
  const onCommandRunRef = useRef(onCommandRun)
  const titleRef = useRef(title)
  const agentLaunchModeRef = useRef(agentLaunchMode)
  const agentResumeSessionIdVerifiedRef = useRef(agentResumeSessionIdVerified)
  const statusRef = useRef(status)
  const isTerminalHydratedRef = useRef(false)
  const [isTerminalHydrated, setIsTerminalHydrated] = useState(false)
  const displayTerminalFontSize = terminalDisplayCalibration?.fontSize ?? terminalFontSize
  const displayTerminalLineHeight = terminalDisplayCalibration?.lineHeight ?? 1
  const displayTerminalLetterSpacing = terminalDisplayCalibration?.letterSpacing ?? 0

  latestSessionIdRef.current = sessionId

  const {
    state: findState,
    open: openTerminalFind,
    close: closeTerminalFind,
    setQuery: setFindQuery,
    findNext: findNextMatch,
    findPrevious: findPreviousMatch,
    toggleCaseSensitive: toggleFindCaseSensitive,
    toggleUseRegex: toggleFindUseRegex,
    bindSearchAddon: bindSearchAddonToFind,
  } = useTerminalFind({
    sessionId,
    terminalRef,
    terminalThemeMode,
  })

  if (rendererRecoveryStateRef.current.sessionId !== sessionId) {
    rendererRecoveryStateRef.current = { sessionId, preferredMode: 'auto', resetVersion: 0 }
    rendererRecoveryPendingRef.current = false
  }

  const preferredRendererMode = rendererRecoveryStateRef.current.preferredMode
  const terminalClientResetVersion = rendererRecoveryStateRef.current.resetVersion

  if (
    initialTerminalGeometryKeyRef.current.sessionId !== sessionId ||
    initialTerminalGeometryKeyRef.current.resetVersion !== terminalClientResetVersion
  ) {
    initialTerminalGeometryRef.current = terminalGeometry
    initialTerminalGeometryKeyRef.current = { sessionId, resetVersion: terminalClientResetVersion }
  }

  useEffect(() => {
    onCommandRunRef.current = onCommandRun
    titleRef.current = title
    agentLaunchModeRef.current = agentLaunchMode
    agentResumeSessionIdVerifiedRef.current = agentResumeSessionIdVerified
    statusRef.current = status
    latestSessionIdRef.current = sessionId
    viewportZoomRef.current = viewportZoom
  }, [
    agentLaunchMode,
    agentResumeSessionIdVerified,
    onCommandRun,
    sessionId,
    status,
    title,
    viewportZoom,
  ])

  useEffect(() => {
    isViewportInteractionActiveRef.current = isViewportInteractionSettledActive
    outputSchedulerRef.current?.onViewportInteractionActiveChange(
      isViewportInteractionSettledActive,
    )
  }, [isViewportInteractionSettledActive])

  const {
    scrollbackBufferRef,
    markScrollbackDirty,
    scheduleScrollbackPublish,
    disposeScrollbackPublish,
    cancelScrollbackPublish,
  } = useTerminalScrollback({
    sessionId,
    scrollback: kind === 'agent' ? null : scrollback,
    onScrollbackChange: kind === 'agent' ? undefined : onScrollbackChange,
    isPointerResizingRef,
  })

  useEffect(() => {
    lastCommittedPtySizeRef.current = null
    suppressPtyResizeRef.current = false
    commandInputStateRef.current = createTerminalCommandInputState()
    isTerminalHydratedRef.current = false
    setIsTerminalHydrated(false)
  }, [sessionId, terminalClientResetVersion])

  useLayoutEffect(() => {
    const terminalContainer = containerRef.current
    return () => {
      const activeElement =
        typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      shouldRestoreTerminalFocusRef.current = Boolean(
        activeElement && terminalContainer?.contains(activeElement),
      )
    }
  }, [sessionId, terminalClientResetVersion])

  useEffect(() => {
    const disposePreservedSession = (): void => {
      preservedXtermSessionRef.current?.dispose()
      preservedXtermSessionRef.current = null
    }
    const clearPendingUserInputBuffer = (): void => {
      pendingUserInputBufferRef.current.length = 0
    }

    return () => {
      disposePreservedSession()
      clearPendingUserInputBuffer()
      cancelWebglCanvasTransformCleanup()
    }
  }, [cancelWebglCanvasTransformCleanup])

  useEffect(() => {
    rendererRecoveryPendingRef.current = false
  }, [sessionId, terminalClientResetVersion])

  const syncTerminalSize = useCallback(() => {
    refreshTerminalNodeSize({
      terminalRef,
      containerRef,
      isPointerResizingRef,
    })
    scheduleWebglCanvasTransformCleanup()
  }, [scheduleWebglCanvasTransformCleanup])

  const commitTerminalGeometry = useCallback(
    (reason: 'frame_commit' | 'appearance_commit') => {
      if (suppressPtyResizeRef.current) {
        syncTerminalSize()
        return
      }

      commitTerminalNodeGeometry({
        terminalRef,
        fitAddonRef,
        containerRef,
        isPointerResizingRef,
        lastCommittedPtySizeRef,
        sessionId,
        reason,
      })
      scheduleWebglCanvasTransformCleanup()
    },
    [scheduleWebglCanvasTransformCleanup, sessionId, syncTerminalSize],
  )

  const requestTerminalRendererRecovery = useCallback(
    ({ forceDom }: TerminalRendererRecoveryRequest) => {
      if (rendererRecoveryPendingRef.current) {
        return
      }

      rendererRecoveryPendingRef.current = true
      const currentTerminal = terminalRef.current
      if (currentTerminal) {
        const capturedScrollState = captureTerminalScrollState(currentTerminal)
        recoveryScrollStateRef.current =
          capturedScrollState.viewportY === null ? null : capturedScrollState
      } else {
        recoveryScrollStateRef.current = null
      }
      const requiresWebglRenderer = kind === 'agent' && terminalProvider === 'opencode'
      if (forceDom && !requiresWebglRenderer) {
        rendererRecoveryStateRef.current.preferredMode = 'dom'
      }
      rendererRecoveryStateRef.current.resetVersion += 1
      invalidateCachedTerminalScreenState(nodeId, sessionId)
      preservedXtermSessionRef.current?.dispose()
      preservedXtermSessionRef.current = null
      cancelWebglCanvasTransformCleanup()
      forceRendererRecoveryRender(value => value + 1)
    },
    [cancelWebglCanvasTransformCleanup, kind, nodeId, sessionId, terminalProvider],
  )

  const applyTerminalTheme = useTerminalThemeApplier({
    terminalRef,
    containerRef,
    terminalThemeMode,
  })
  const { transcriptRef, scheduleTranscriptSync } = useTerminalTestTranscriptMirror({
    enabled: isTestEnvironment || diagnosticsEnabled,
    nodeId,
    resetKey: sessionId,
    terminalRef,
  })
  const { draftFrame, handleResizePointerDown } = useTerminalResize({
    position,
    width,
    height,
    minSize:
      kind === 'agent'
        ? resolveAgentNodeMinSize(terminalProvider)
        : resolveCanonicalNodeMinSize(kind),
    onResize,
    commitTerminalGeometry: () => {
      commitTerminalGeometry('frame_commit')
    },
    scheduleScrollbackPublish,
    isPointerResizingRef,
  })
  const sizeStyle = resolveTerminalNodeFrameStyle({ draftFrame, position, width, height })

  useTerminalPlaceholderSession({
    nodeId,
    sessionId,
    kind,
    scrollback: kind === 'agent' ? null : scrollback,
    terminalProvider,
    terminalThemeMode,
    isTestEnvironment,
    containerRef,
    terminalRef,
    fitAddonRef,
    isPointerResizingRef,
    suppressPtyResizeRef,
    syncTerminalSize,
    applyTerminalTheme,
    bindSearchAddonToFind,
    isTerminalHydratedRef,
    setIsTerminalHydrated,
    scheduleTranscriptSync,
    shouldRestoreTerminalFocusRef,
    latestSessionIdRef,
    preservedXtermSessionRef,
    recentUserInteractionAtRef,
    pendingUserInputBufferRef,
    activeRendererKindRef,
    cancelWebglCanvasTransformCleanup,
    setRendererKindAndApply,
    terminalFontSize,
    viewportZoomRef,
    preferredRendererMode,
    terminalClientResetVersion,
  })

  useTerminalRuntimeSession({
    nodeId,
    sessionId,
    kind,
    terminalProvider,
    initialTerminalGeometryRef,
    agentLaunchModeRef,
    agentResumeSessionIdVerifiedRef,
    statusRef,
    titleRef,
    terminalThemeMode,
    isTestEnvironment,
    containerRef,
    terminalRef,
    fitAddonRef,
    outputSchedulerRef,
    isViewportInteractionActiveRef,
    isPointerResizingRef,
    suppressPtyResizeRef,
    lastCommittedPtySizeRef,
    commandInputStateRef,
    onCommandRunRef,
    scrollbackBufferRef,
    markScrollbackDirty,
    scheduleTranscriptSync,
    cancelScrollbackPublish,
    disposeScrollbackPublish,
    syncTerminalSize,
    applyTerminalTheme,
    bindSearchAddonToFind,
    openTerminalFind,
    isTerminalHydratedRef,
    setIsTerminalHydrated,
    shouldRestoreTerminalFocusRef,
    preservedXtermSessionRef,
    recentUserInteractionAtRef,
    pendingUserInputBufferRef,
    recoveryScrollStateRef,
    isLiveSessionReattach,
    activeRendererKindRef,
    scheduleWebglCanvasTransformCleanup,
    cancelWebglCanvasTransformCleanup,
    setRendererKindAndApply,
    terminalFontSize,
    viewportZoomRef,
    preferredRendererMode,
    terminalClientResetVersion,
    requestTerminalRendererRecovery,
  })

  useTerminalAppearanceSync({
    terminalRef,
    syncTerminalSize,
    commitTerminalGeometry: () => {
      commitTerminalGeometry('appearance_commit')
    },
    terminalFontSize,
    displayTerminalFontSize,
    displayTerminalLineHeight,
    displayTerminalLetterSpacing,
    terminalFontFamily,
    width,
    height,
    viewportZoom,
    isViewportInteractionActive: isViewportInteractionSettledActive,
  })
  useTerminalFileDropPaste({ containerRef, terminalRef })

  const hasSelectedDragSurface = isDragSurfaceSelectionMode && (isSelected || isDragging)
  const isRecoveringAgentOutput =
    kind === 'agent' && sessionId.trim().length > 0 && !isTerminalHydrated && !lastError
  const {
    consumeIgnoredClick: consumeIgnoredTerminalBodyClick,
    handlePointerDownCapture: handleTerminalBodyPointerDownCapture,
    handlePointerMoveCapture: handleTerminalBodyPointerMoveCapture,
    handlePointerUp: handleTerminalBodyPointerUp,
  } = useTerminalBodyClickFallback(onInteractionStart)

  return (
    <TerminalNodeFrame
      title={title}
      fixedTitlePrefix={fixedTitlePrefix}
      kind={kind}
      labelColor={labelColor}
      agentExecutionDirectory={agentExecutionDirectory}
      agentResumeSessionId={agentResumeSessionId}
      agentResumeSessionIdVerified={agentResumeSessionIdVerified}
      terminalThemeMode={terminalThemeMode}
      isSelected={hasSelectedDragSurface}
      isDragging={isDragging}
      status={status}
      directoryMismatch={directoryMismatch}
      lastError={lastError}
      sessionId={sessionId}
      isTerminalHydrated={isTerminalHydrated}
      isRecoveringAgentOutput={isRecoveringAgentOutput}
      transcriptRef={transcriptRef}
      sizeStyle={sizeStyle}
      containerRef={containerRef}
      handleTerminalBodyPointerDownCapture={handleTerminalBodyPointerDownCapture}
      handleTerminalBodyPointerMoveCapture={handleTerminalBodyPointerMoveCapture}
      handleTerminalBodyPointerUp={handleTerminalBodyPointerUp}
      consumeIgnoredTerminalBodyClick={consumeIgnoredTerminalBodyClick}
      onInteractionStart={onInteractionStart}
      onTitleCommit={onTitleCommit}
      onClose={onClose}
      onCopyLastMessage={onCopyLastMessage}
      onReloadSession={onReloadSession}
      onListSessions={onListSessions}
      onSwitchSession={onSwitchSession}
      find={findState}
      onFindQueryChange={setFindQuery}
      onFindNext={findNextMatch}
      onFindPrevious={findPreviousMatch}
      onFindClose={closeTerminalFind}
      onFindToggleCaseSensitive={toggleFindCaseSensitive}
      onFindToggleUseRegex={toggleFindUseRegex}
      handleResizePointerDown={handleResizePointerDown}
    />
  )
}
