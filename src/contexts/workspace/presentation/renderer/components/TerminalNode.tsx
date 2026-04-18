import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '@xyflow/react'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { createTerminalCommandInputState } from './terminalNode/commandInput'
import { syncTerminalNodeSize } from './terminalNode/syncTerminalNodeSize'
import { resolveTerminalNodeFrameStyle } from './terminalNode/nodeFrameStyle'
import { useTerminalAppearanceSync } from './terminalNode/useTerminalAppearanceSync'
import { useTerminalTestTranscriptMirror } from './terminalNode/useTerminalTestTranscriptMirror'
import { useTerminalThemeApplier } from './terminalNode/useTerminalThemeApplier'
import { useTerminalBodyClickFallback } from './terminalNode/useTerminalBodyClickFallback'
import { useTerminalFind } from './terminalNode/useTerminalFind'
import { useTerminalResize } from './terminalNode/useTerminalResize'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import type { TerminalOutputScheduler } from './terminalNode/outputScheduler'
import { useTerminalRuntimeSession } from './terminalNode/useTerminalRuntimeSession'
import { useTerminalPlaceholderSession } from './terminalNode/useTerminalPlaceholderSession'
import { useWebglPixelSnappingScheduler } from './terminalNode/useWebglPixelSnappingScheduler'
import type { XtermSession } from './terminalNode/xtermSession'
import {
  selectDragSurfaceSelectionMode,
  selectViewportInteractionActive,
} from './terminalNode/reactFlowState'
import { TerminalNodeFrame } from './terminalNode/TerminalNodeFrame'
import { resolveCanonicalNodeMinSize } from '../utils/workspaceNodeSizing'
import type { TerminalNodeProps } from './TerminalNode.types'

export function TerminalNode({
  nodeId,
  sessionId,
  title,
  kind,
  labelColor,
  terminalProvider = null,
  agentLaunchMode = null,
  agentResumeSessionIdVerified = false,
  isLiveSessionReattach = false,
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
  scrollback,
  onClose,
  onCopyLastMessage,
  onResize,
  onScrollbackChange,
  onTitleCommit,
  onCommandRun,
  onInteractionStart,
}: TerminalNodeProps): JSX.Element {
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const isViewportInteractionActive = useStore(selectViewportInteractionActive)
  const isTestEnvironment = window.opencoveApi.meta.isTest
  const diagnosticsEnabled = window.opencoveApi.meta?.enableTerminalDiagnostics === true
  const outputSchedulerRef = useRef<TerminalOutputScheduler | null>(null)
  const isViewportInteractionActiveRef = useRef(isViewportInteractionActive)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const shouldRestoreTerminalFocusRef = useRef(false)
  const latestSessionIdRef = useRef(sessionId)
  const preservedXtermSessionRef = useRef<XtermSession | null>(null)
  const recentUserInteractionAtRef = useRef(0)
  const pendingUserInputBufferRef = useRef<Array<{ data: string; encoding: 'utf8' | 'binary' }>>([])
  const {
    activeRendererKindRef,
    scheduleWebglPixelSnapping,
    cancelWebglPixelSnapping,
    setRendererKindAndApply,
  } = useWebglPixelSnappingScheduler({ containerRef })
  const isPointerResizingRef = useRef(false)
  const lastSyncedPtySizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const suppressPtyResizeRef = useRef(false)
  const commandInputStateRef = useRef(createTerminalCommandInputState())
  const onCommandRunRef = useRef(onCommandRun)
  const titleRef = useRef(title)
  const agentLaunchModeRef = useRef(agentLaunchMode)
  const agentResumeSessionIdVerifiedRef = useRef(agentResumeSessionIdVerified)
  const statusRef = useRef(status)
  const isTerminalHydratedRef = useRef(false)
  const [isTerminalHydrated, setIsTerminalHydrated] = useState(false)
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

  useEffect(() => {
    onCommandRunRef.current = onCommandRun
    titleRef.current = title
    agentLaunchModeRef.current = agentLaunchMode
    agentResumeSessionIdVerifiedRef.current = agentResumeSessionIdVerified
    statusRef.current = status
    latestSessionIdRef.current = sessionId
  }, [agentLaunchMode, agentResumeSessionIdVerified, onCommandRun, sessionId, status, title])

  useEffect(() => {
    isViewportInteractionActiveRef.current = isViewportInteractionActive
    outputSchedulerRef.current?.onViewportInteractionActiveChange(isViewportInteractionActive)
  }, [isViewportInteractionActive])

  const {
    scrollbackBufferRef,
    markScrollbackDirty,
    scheduleScrollbackPublish,
    disposeScrollbackPublish,
    cancelScrollbackPublish,
  } = useTerminalScrollback({
    sessionId,
    scrollback,
    onScrollbackChange,
    isPointerResizingRef,
  })

  useEffect(() => {
    lastSyncedPtySizeRef.current = null
    suppressPtyResizeRef.current = false
    commandInputStateRef.current = createTerminalCommandInputState()
    isTerminalHydratedRef.current = false
    setIsTerminalHydrated(false)
  }, [sessionId])

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
  }, [sessionId])

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
      cancelWebglPixelSnapping()
    }
  }, [cancelWebglPixelSnapping])

  const syncTerminalSize = useCallback(() => {
    syncTerminalNodeSize({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      lastSyncedPtySizeRef,
      sessionId,
      shouldResizePty: !suppressPtyResizeRef.current,
    })
    scheduleWebglPixelSnapping()
  }, [scheduleWebglPixelSnapping, sessionId])

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
    minSize: resolveCanonicalNodeMinSize(kind),
    onResize,
    syncTerminalSize,
    scheduleScrollbackPublish,
    isPointerResizingRef,
  })
  const sizeStyle = resolveTerminalNodeFrameStyle({ draftFrame, position, width, height })

  useTerminalPlaceholderSession({
    nodeId,
    sessionId,
    kind,
    scrollback,
    terminalProvider,
    terminalThemeMode,
    isTestEnvironment,
    containerRef,
    terminalRef,
    fitAddonRef,
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
    scheduleWebglPixelSnapping,
    cancelWebglPixelSnapping,
    setRendererKindAndApply,
    terminalFontSize,
  })

  useTerminalRuntimeSession({
    nodeId,
    sessionId,
    kind,
    terminalProvider,
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
    suppressPtyResizeRef,
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
    isLiveSessionReattach,
    activeRendererKindRef,
    scheduleWebglPixelSnapping,
    cancelWebglPixelSnapping,
    setRendererKindAndApply,
    terminalFontSize,
  })

  useTerminalAppearanceSync({
    terminalRef,
    syncTerminalSize,
    terminalFontSize,
    terminalFontFamily,
    width,
    height,
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }

    const handleDragOver = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    const handleDrop = (e: DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) {
        return
      }

      const paths = Array.from(files)
        .map(f => window.opencoveApi.filesystem.getPathForFile(f))
        .filter(p => p.length > 0)
        .map(p => (/^[a-zA-Z0-9_./-]+$/.test(p) ? p : "'" + p.replace(/'/g, "'\\''") + "'"))
        .join(' ')

      if (paths.length > 0) {
        terminalRef.current?.paste(paths)
      }
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('drop', handleDrop)

    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('drop', handleDrop)
    }
  }, [])

  const hasSelectedDragSurface = isDragSurfaceSelectionMode && (isSelected || isDragging)
  const {
    consumeIgnoredClick: consumeIgnoredTerminalBodyClick,
    handlePointerDownCapture: handleTerminalBodyPointerDownCapture,
    handlePointerMoveCapture: handleTerminalBodyPointerMoveCapture,
    handlePointerUp: handleTerminalBodyPointerUp,
  } = useTerminalBodyClickFallback(onInteractionStart)

  return (
    <TerminalNodeFrame
      title={title}
      kind={kind}
      labelColor={labelColor}
      terminalThemeMode={terminalThemeMode}
      isSelected={hasSelectedDragSurface}
      isDragging={isDragging}
      status={status}
      directoryMismatch={directoryMismatch}
      lastError={lastError}
      sessionId={sessionId}
      isTerminalHydrated={isTerminalHydrated}
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
