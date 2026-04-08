import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { createRollingTextBuffer } from '../utils/rollingTextBuffer'
import { createTerminalCommandInputState } from './terminalNode/commandInput'
import { type TerminalShortcutDecision } from './terminalNode/inputBridge'
import { registerTerminalLayoutSync } from './terminalNode/layoutSync'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
} from './terminalNode/screenStateCache'
import { resolveAttachablePtyApi } from './terminalNode/attachablePty'
import { cacheTerminalScreenStateOnUnmount } from './terminalNode/cacheTerminalScreenState'
import { resolveTerminalNodeFrameStyle } from './terminalNode/nodeFrameStyle'
import { resolveTerminalTheme, resolveTerminalUiTheme } from './terminalNode/theme'
import { useTerminalAppearanceSync } from './terminalNode/useTerminalAppearanceSync'
import { useTerminalTestTranscriptMirror } from './terminalNode/useTerminalTestTranscriptMirror'
import { useTerminalThemeApplier } from './terminalNode/useTerminalThemeApplier'
import { useTerminalBodyClickFallback } from './terminalNode/useTerminalBodyClickFallback'
import { useTerminalFind } from './terminalNode/useTerminalFind'
import { useTerminalResize } from './terminalNode/useTerminalResize'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import { createCommittedScreenStateRecorder } from './terminalNode/committedScreenState'
import { MAX_SCROLLBACK_CHARS } from './terminalNode/constants'
import { resolveInitialTerminalDimensions } from './terminalNode/initialDimensions'
import { createTerminalOutputScheduler } from './terminalNode/outputScheduler'
import { openTerminalSurface } from './terminalNode/openTerminalSurface'
import {
  createTrackedPtyWriteQueue,
  registerTerminalInputRuntime,
} from './terminalNode/inputRuntime'
import { registerTerminalPtyInputListeners } from './terminalNode/registerTerminalPtyInputListeners'
import { createTerminalRuntimePrimitives } from './terminalNode/createTerminalRuntimePrimitives'
import { createTerminalDiagnosticsBridge } from './terminalNode/createTerminalDiagnosticsBridge'
import { startTerminalHydration } from './terminalNode/startTerminalHydration'
import {
  selectDragSurfaceSelectionMode,
  selectViewportInteractionActive,
} from './terminalNode/reactFlowState'
import { useTerminalRuntimeRefs } from './terminalNode/useTerminalRuntimeRefs'
import { useTerminalSessionReset } from './terminalNode/useTerminalSessionReset'
import { useTerminalSyncCallbacks } from './terminalNode/useTerminalSyncCallbacks'
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
  const voiceInputCtrlCOptimizationEnabled = useAppStore(
    state => state.agentSettings.experimentalVoiceInputCtrlCOptimizationEnabled,
  )
  const isDragSurfaceSelectionMode = useStore(selectDragSurfaceSelectionMode)
  const isViewportInteractionActive = useStore(selectViewportInteractionActive)
  const isTestEnvironment = window.opencoveApi.meta.isTest
  const diagnosticsEnabled = window.opencoveApi.meta?.enableTerminalDiagnostics === true
  const outputSchedulerRef = useRef<ReturnType<typeof createTerminalOutputScheduler> | null>(null)
  const isViewportInteractionActiveRef = useRef(isViewportInteractionActive)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeRendererKindRef = useRef<'webgl' | 'dom'>('dom')
  const pixelSnapFrameRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isPointerResizingRef = useRef(false)
  const lastSyncedPtySizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const suppressPtyResizeRef = useRef(false)
  const commandInputStateRef = useRef(createTerminalCommandInputState())
  const onCommandRunRef = useRef(onCommandRun)
  const titleRef = useRef(title)
  const isTerminalHydratedRef = useRef(false)
  const [isTerminalHydrated, setIsTerminalHydrated] = useState(false)
  const {
    state: findState,
    open: openTerminalFind,
    close: closeTerminalFind,
    setQuery: setFindQuery,
    findNext: findNextMatch,
    findPrevious: findPreviousMatch,
    bindSearchAddon: bindSearchAddonToFind,
  } = useTerminalFind({
    sessionId,
    terminalRef,
    terminalThemeMode,
  })
  useTerminalRuntimeRefs({
    isViewportInteractionActive,
    isViewportInteractionActiveRef,
    onCommandRun,
    onCommandRunRef,
    outputSchedulerRef,
    title,
    titleRef,
  })
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
  useTerminalSessionReset({
    commandInputStateRef,
    isTerminalHydratedRef,
    lastSyncedPtySizeRef,
    sessionId,
    setIsTerminalHydrated,
    suppressPtyResizeRef,
  })
  const { scheduleWebglPixelSnapping, syncTerminalSize } = useTerminalSyncCallbacks({
    activeRendererKindRef,
    containerRef,
    fitAddonRef,
    isPointerResizingRef,
    lastSyncedPtySizeRef,
    pixelSnapFrameRef,
    sessionId,
    suppressPtyResizeRef,
    terminalRef,
  })
  const applyTerminalTheme = useTerminalThemeApplier({
    terminalRef,
    containerRef,
    terminalThemeMode,
  })
  const { transcriptRef, scheduleTranscriptSync } = useTerminalTestTranscriptMirror({
    enabled: isTestEnvironment || diagnosticsEnabled,
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
  useEffect(() => {
    if (sessionId.trim().length === 0) {
      return undefined
    }
    const ptyWithOptionalAttach = resolveAttachablePtyApi()
    const cachedScreenState = getCachedTerminalScreenState(nodeId, sessionId)
    suppressPtyResizeRef.current = Boolean(cachedScreenState?.serialized.includes('\u001b[?1049h'))
    const initialDimensions = resolveInitialTerminalDimensions(cachedScreenState)
    const scrollbackBuffer = scrollbackBufferRef.current
    const committedScrollbackBuffer = createRollingTextBuffer({
      maxChars: MAX_SCROLLBACK_CHARS,
      initial: scrollbackBuffer.snapshot(),
    })
    const initialTerminalTheme = resolveTerminalTheme(terminalThemeMode)
    const resolvedTerminalUiTheme = resolveTerminalUiTheme(terminalThemeMode)
    const windowsPty = window.opencoveApi.meta?.windowsPty ?? null
    const logTerminalDiagnostics =
      window.opencoveApi.debug?.logTerminalDiagnostics ?? (() => undefined)
    const { activeRenderer, disposeTerminalFind, fitAddon, serializeAddon, terminal } =
      createTerminalRuntimePrimitives({
        bindSearchAddonToFind,
        initialDimensions,
        initialTerminalTheme,
        terminalProvider,
        windowsPty,
      })
    activeRendererKindRef.current = activeRenderer.kind
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    let logTerminalShortcutDecision = (_decision: TerminalShortcutDecision): void => undefined
    let logQueuedPtyWrite = (_payload: { data: string; encoding: 'utf8' | 'binary' }): void =>
      undefined
    const ptyWriteQueue = createTrackedPtyWriteQueue({
      sessionId,
      onPtyWrite: payload => {
        logQueuedPtyWrite(payload)
      },
    })
    const windowsAutomationPasteGuardEnabled =
      voiceInputCtrlCOptimizationEnabled ??
      window.opencoveApi.meta?.enableWindowsAutomationPasteGuard === true
    const { selectionChangeDisposable, windowsAutomationPasteGuard } = registerTerminalInputRuntime(
      {
        onOpenFind: openTerminalFind,
        onShortcutDecision: decision => {
          logTerminalShortcutDecision(decision)
        },
        ptyWriteQueue,
        terminal,
        windowsAutomationPasteGuardEnabled,
      },
    )
    let cancelMouseServicePatch: () => void = () => undefined
    let disposeContainerRuntime: () => void = () => undefined
    let disposePositionObserver: () => void = () => undefined
    let disposeTerminalHitTargetCursorScope: () => void = () => undefined
    let disposeTerminalSelectionTestHandle: () => void = () => undefined
    if (containerRef.current) {
      const surfaceRuntime = openTerminalSurface({
        activeRenderer,
        activeRendererKindRef,
        container: containerRef.current,
        nodeId,
        resolvedTerminalUiTheme,
        scheduleTranscriptSync,
        scheduleWebglPixelSnapping,
        sessionId,
        syncTerminalSize,
        terminal,
        windowsAutomationPasteGuard,
        isTestEnvironment,
      })
      cancelMouseServicePatch = surfaceRuntime.cancelMouseServicePatch
      disposeContainerRuntime = surfaceRuntime.disposeContainerRuntime
      disposePositionObserver = surfaceRuntime.disposePositionObserver
      disposeTerminalHitTargetCursorScope = surfaceRuntime.disposeTerminalHitTargetCursorScope
      disposeTerminalSelectionTestHandle = surfaceRuntime.disposeTerminalSelectionTestHandle
    }
    const { logPtyWrite, logShortcutDecision, terminalDiagnostics } =
      createTerminalDiagnosticsBridge({
        container: containerRef.current,
        diagnosticsEnabled,
        emit: logTerminalDiagnostics,
        kind: kind === 'agent' ? 'agent' : 'terminal',
        nodeId,
        rendererKind: activeRenderer.kind,
        sessionId,
        terminal,
        terminalThemeMode,
        title: titleRef.current,
        windowsPty,
      })
    logTerminalShortcutDecision = decision => {
      logShortcutDecision(decision)
    }
    logQueuedPtyWrite = payload => {
      logPtyWrite(payload)
    }
    let isDisposed = false,
      shouldForwardTerminalData = false
    const { dataDisposable, binaryDisposable } = registerTerminalPtyInputListeners({
      commandInputStateRef,
      onCommandRunRef,
      ptyWriteQueue,
      shouldForwardTerminalData: () => shouldForwardTerminalData,
      suppressPtyResizeRef,
      syncTerminalSize,
      terminal,
    })

    let isHydrating = true
    const hydrationBuffer = { dataChunks: [] as string[], exitCode: null as number | null }
    const ptyEventHub = getPtyEventHub()
    const committedScreenStateRecorder = createCommittedScreenStateRecorder({
      serializeAddon,
      sessionId,
      terminal,
    })
    const outputScheduler = createTerminalOutputScheduler({
      terminal,
      scrollbackBuffer,
      markScrollbackDirty,
      onWriteCommitted: data => {
        committedScrollbackBuffer.append(data)
        committedScreenStateRecorder.record(committedScrollbackBuffer.snapshot())
        scheduleTranscriptSync()
      },
    })
    outputSchedulerRef.current = outputScheduler
    outputScheduler.onViewportInteractionActiveChange(isViewportInteractionActiveRef.current)
    const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
      if (isHydrating) {
        hydrationBuffer.dataChunks.push(event.data)
        return
      }
      outputScheduler.handleChunk(event.data)
    })

    const unsubscribeExit = ptyEventHub.onSessionExit(sessionId, event => {
      if (isHydrating) {
        hydrationBuffer.exitCode = event.exitCode
        return
      }

      outputScheduler.handleChunk(`\r\n[process exited with code ${event.exitCode}]\r\n`, {
        immediateScrollbackPublish: true,
      })
    })
    startTerminalHydration({
      attachPromise: Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId })),
      cachedScreenState,
      committedScrollbackBuffer,
      hydrationBuffer,
      isDisposed: () => isDisposed,
      logHydrated: details => {
        terminalDiagnostics.logHydrated(details)
      },
      markScrollbackDirty,
      onBeforeFinalize: () => {
        shouldForwardTerminalData = true
        isHydrating = false
      },
      onCommittedScreenState: nextRawSnapshot => {
        committedScreenStateRecorder.record(nextRawSnapshot)
      },
      onHydratedWriteCommitted: rawSnapshot => {
        committedScrollbackBuffer.set(rawSnapshot)
        committedScreenStateRecorder.record(rawSnapshot)
        scheduleTranscriptSync()
      },
      onRevealed: () => {
        if (!isDisposed) {
          isTerminalHydratedRef.current = true
          setIsTerminalHydrated(true)
        }
      },
      persistedSnapshot: scrollbackBuffer.snapshot(),
      ptyWriteQueue,
      scheduleTranscriptSync,
      sessionId,
      scrollbackBuffer,
      syncTerminalSize,
      takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
      terminal,
    })
    const resizeObserver = new ResizeObserver(syncTerminalSize)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }
    const disposeLayoutSync = registerTerminalLayoutSync(syncTerminalSize)
    const handleThemeChange = () => {
      if (terminalThemeMode !== 'sync-with-ui') {
        return
      }
      applyTerminalTheme()
      activeRenderer.clearTextureAtlas()
      syncTerminalSize()
    }
    window.addEventListener('opencove-theme-changed', handleThemeChange)
    return () => {
      suppressPtyResizeRef.current = false
      const isInvalidated = isCachedTerminalScreenStateInvalidated(nodeId, sessionId)
      cacheTerminalScreenStateOnUnmount({
        nodeId,
        isInvalidated,
        isTerminalHydrated: isTerminalHydratedRef.current,
        hasPendingWrites: outputScheduler.hasPendingWrites(),
        rawSnapshot: scrollbackBuffer.snapshot(),
        resolveCommittedScreenState: committedScreenStateRecorder.resolve,
      })
      cancelMouseServicePatch()
      disposeTerminalHitTargetCursorScope()
      disposePositionObserver()
      activeRenderer.dispose()
      isDisposed = true
      disposeLayoutSync()
      terminalDiagnostics.dispose()
      selectionChangeDisposable.dispose()
      windowsAutomationPasteGuard?.dispose()
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
      disposeContainerRuntime()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      binaryDisposable.dispose()
      unsubscribeData()
      unsubscribeExit()
      disposeTerminalSelectionTestHandle()
      disposeTerminalFind()
      outputScheduler.dispose()
      outputSchedulerRef.current = null
      ptyWriteQueue.dispose()
      if (isInvalidated) {
        cancelScrollbackPublish()
        clearCachedTerminalScreenStateInvalidation(nodeId, sessionId)
      } else {
        disposeScrollbackPublish()
      }
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      activeRendererKindRef.current = 'dom'
      if (pixelSnapFrameRef.current !== null) {
        window.cancelAnimationFrame(pixelSnapFrameRef.current)
        pixelSnapFrameRef.current = null
      }
    }
  }, [
    cancelScrollbackPublish,
    applyTerminalTheme,
    bindSearchAddonToFind,
    nodeId,
    disposeScrollbackPublish,
    diagnosticsEnabled,
    markScrollbackDirty,
    openTerminalFind,
    scrollbackBufferRef,
    scheduleTranscriptSync,
    scheduleWebglPixelSnapping,
    sessionId,
    syncTerminalSize,
    terminalThemeMode,
    terminalProvider,
    voiceInputCtrlCOptimizationEnabled,
    isTestEnvironment,
    kind,
  ])
  useTerminalAppearanceSync({
    terminalRef,
    syncTerminalSize,
    terminalFontSize,
    terminalFontFamily,
    width,
    height,
  })
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
      handleResizePointerDown={handleResizePointerDown}
    />
  )
}
