import { useEffect } from 'react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { createRollingTextBuffer } from '../../utils/rollingTextBuffer'
import { createRuntimeTerminalInputBridge } from './createRuntimeTerminalInputBridge'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
} from './screenStateCache'
import { commitInitialTerminalNodeGeometry } from './syncTerminalNodeSize'
import { resolveAttachablePtyApi } from './attachablePty'
import { cacheTerminalScreenStateOnUnmount } from './cacheTerminalScreenState'
import { MAX_SCROLLBACK_CHARS } from './constants'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { createTerminalOutputScheduler } from './outputScheduler'
import {
  containsDestructiveTerminalDisplayControlSequence,
  shouldDeferHydratedTerminalRedrawChunk,
} from './hydrationReplacement'
import { createCommittedScreenStateRecorder } from './committedScreenState'
import { createTerminalHydrationRouter } from './hydrationRouter'
import { createMountedXtermSession } from './xtermSession'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import { registerTerminalRuntimeTestHandles } from './testHarness'
import type { TerminalRuntimeSessionOptions } from './useTerminalRuntimeSession.types'
import {
  formatTerminalDataHeadHex,
  hasVisibleTerminalBufferContent,
} from './terminalRuntimeDiagnostics'
import {
  markRecentTerminalUserInteraction,
  registerTerminalUserInteractionWindow,
} from './userInteractionWindow'
import {
  createOptionalOpenCodeThemeBridge,
  shouldReusePreservedXtermSession,
  scheduleTestEnvironmentTerminalAutoFocus,
  prepareRuntimePresentationAttach,
  registerRuntimeRendererAndThemeSync,
  shouldAwaitRestoredAgentVisibleOutput,
  shouldGateRestoredAgentInput,
  shouldTreatHydratedAgentBaselineAsPlaceholder,
  type TerminalHydrationBaselineSource,
} from './useTerminalRuntimeSession.support'
import { createRestoredAgentVisibilityGate } from './restoredAgentVisibilityGate'
import { startRuntimeTerminalHydration } from './runtimeHydrationStarter'

export function useTerminalRuntimeSession({
  nodeId,
  sessionId,
  kind,
  terminalProvider,
  agentLaunchModeRef,
  agentResumeSessionIdVerifiedRef,
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
  isLiveSessionReattach,
  activeRendererKindRef,
  scheduleWebglPixelSnapping,
  cancelWebglPixelSnapping,
  setRendererKindAndApply,
  terminalFontSize,
  viewportZoomRef,
  preferredRendererMode,
  terminalClientResetVersion,
  requestTerminalRendererRecovery,
}: TerminalRuntimeSessionOptions): void {
  useEffect(() => {
    if (sessionId.trim().length === 0 || !containerRef.current) {
      return undefined
    }
    const cachedScreenState =
      kind === 'agent' ? null : getCachedTerminalScreenState(nodeId, sessionId)
    suppressPtyResizeRef.current = Boolean(cachedScreenState?.serialized.includes('\u001b[?1049h'))
    const initialDimensions = resolveInitialTerminalDimensions(cachedScreenState)
    const scrollbackBuffer = scrollbackBufferRef.current
    const pendingUserInputBuffer = pendingUserInputBufferRef.current
    const rendererBaselineSnapshot = kind === 'agent' ? '' : scrollbackBuffer.snapshot()
    const shouldGateInitialUserInput = shouldGateRestoredAgentInput({
      kind,
      persistedSnapshot: rendererBaselineSnapshot,
      agentResumeSessionIdVerified: agentResumeSessionIdVerifiedRef.current === true,
      agentLaunchMode: agentLaunchModeRef.current,
    })
    const shouldAwaitAgentVisibleOutput = shouldAwaitRestoredAgentVisibleOutput({
      kind,
      agentResumeSessionIdVerified: agentResumeSessionIdVerifiedRef.current === true,
      agentLaunchMode: agentLaunchModeRef.current,
    })
    const committedScrollbackBuffer = createRollingTextBuffer({
      maxChars: MAX_SCROLLBACK_CHARS,
      initial: rendererBaselineSnapshot,
    })
    const windowsPty = window.opencoveApi.meta?.windowsPty ?? null
    const inputDiagnosticsEnabled = window.opencoveApi.meta?.enableTerminalInputDiagnostics === true
    const diagnosticsEnabled =
      window.opencoveApi.meta?.enableTerminalDiagnostics === true || inputDiagnosticsEnabled
    const logTerminalDiagnostics =
      window.opencoveApi.debug?.logTerminalDiagnostics ?? (() => undefined)
    const preservedSession = preservedXtermSessionRef.current
    preservedXtermSessionRef.current = null
    const canReusePreservedSession = shouldReusePreservedXtermSession({
      preservedSession,
      terminalClientResetVersion,
    })
    const hasPreservedVisibleBaseline = canReusePreservedSession && preservedSession !== null
    const session =
      (canReusePreservedSession ? preservedSession : null) ??
      createMountedXtermSession({
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
        fontSize: terminalFontSize,
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
      })
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
        nodeKind: kind === 'agent' ? 'agent' : 'terminal',
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
    terminalRef.current = session.terminal
    fitAddonRef.current = session.fitAddon
    const terminal = session.terminal
    setRendererKindAndApply(session.renderer.kind)
    const disposeInteractionWindow = registerTerminalUserInteractionWindow({
      container: containerRef.current,
      interactionAtRef: recentUserInteractionAtRef,
    })
    if (shouldRestoreTerminalFocusRef.current) {
      shouldRestoreTerminalFocusRef.current = false
      terminal.focus()
    }
    const serializeAddon = session.serializeAddon
    const terminalDiagnostics = session.diagnostics
    const testEnvironmentAutoFocusFrame = scheduleTestEnvironmentTerminalAutoFocus({
      enabled: isTestEnvironment,
      container: containerRef.current,
      terminal,
      scheduleTranscriptSync,
    })
    const runtimeInputBridge = createRuntimeTerminalInputBridge({
      terminal,
      sessionId,
      openTerminalFind,
      onCommandRunRef,
      commandInputStateRef,
      suppressPtyResizeRef,
      syncTerminalSize,
      shouldGateInitialUserInput,
      pendingUserInputBufferRef,
      recentUserInteractionAtRef,
      inputDiagnosticsEnabled,
      terminalDiagnostics,
    })
    session.disposePlaceholderHandoffInputCapture?.()
    session.disposePlaceholderHandoffInputCapture = undefined
    const { ptyWriteQueue } = runtimeInputBridge
    const disposeRuntimeTestHandles = registerTerminalRuntimeTestHandles({
      enabled: isTestEnvironment,
      nodeId,
      sessionId,
      emitBinaryInput: data => {
        markRecentTerminalUserInteraction(recentUserInteractionAtRef)
        ptyWriteQueue.enqueue(data, 'binary')
        ptyWriteQueue.flush()
        return true
      },
    })
    const openCodeThemeBridge = createOptionalOpenCodeThemeBridge({
      terminalProvider,
      terminal,
      ptyWriteQueue,
      terminalThemeMode,
    })
    let isDisposed = false
    let protectRestoredVisibleBaseline: () => void = () => undefined
    const restoredAgentVisibilityGate = createRestoredAgentVisibilityGate({
      terminal,
      shouldAwaitAgentVisibleOutput,
      shouldGateInitialUserInput,
      isDisposed: () => isDisposed,
      markHydrated: () => {
        isTerminalHydratedRef.current = true
        setIsTerminalHydrated(true)
      },
      protectVisibleBaseline: () => {
        protectRestoredVisibleBaseline()
      },
      scheduleTranscriptSync,
      reportThemeMode: () => openCodeThemeBridge?.reportThemeMode(),
      releaseBufferedUserInput: runtimeInputBridge.releaseBufferedUserInput,
      log: terminalDiagnostics.log,
    })
    const ptyEventHub = getPtyEventHub()
    const hydrationBaselineSourceRef: { current: TerminalHydrationBaselineSource } = {
      current:
        preservedSession !== null ||
        cachedScreenState?.serialized.length ||
        rendererBaselineSnapshot.trim().length > 0
          ? 'placeholder_snapshot'
          : 'empty',
    }
    const { attachPromise, presentationSnapshotPromise } = prepareRuntimePresentationAttach({
      ptyApi: resolveAttachablePtyApi(),
      sessionId,
      isLiveSessionReattach,
      commitInitialGeometry: () =>
        commitInitialTerminalNodeGeometry({
          terminalRef,
          fitAddonRef,
          containerRef,
          isPointerResizingRef,
          lastCommittedPtySizeRef,
          sessionId,
          reason: 'frame_commit',
        }),
    })
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
        restoredAgentVisibilityGate.notifyWriteCommitted(data)
      },
    })
    outputSchedulerRef.current = outputScheduler
    outputScheduler.onViewportInteractionActiveChange(isViewportInteractionActiveRef.current)
    const hydrationRouter = createTerminalHydrationRouter({
      terminal,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () =>
        shouldTreatHydratedAgentBaselineAsPlaceholder({
          kind,
          agentResumeSessionIdVerified: agentResumeSessionIdVerifiedRef.current === true,
          agentLaunchMode: agentLaunchModeRef.current,
          persistedSnapshot: kind === 'agent' ? '' : scrollbackBuffer.snapshot(),
          baselineSource: hydrationBaselineSourceRef.current,
        }),
      shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => kind === 'agent',
      shouldDeferHydratedRedrawChunks: () =>
        hasPreservedVisibleBaseline || hasVisibleTerminalBufferContent(terminal),
      scrollbackBuffer,
      committedScrollbackBuffer,
      recordCommittedScreenState: nextRawSnapshot => {
        committedScreenStateRecorder.record(nextRawSnapshot)
      },
      scheduleTranscriptSync,
      ptyWriteQueue,
      markScrollbackDirty,
      logHydrated: details => {
        terminalDiagnostics.logHydrated(details)
      },
      syncTerminalSize,
      onReplayWriteCommitted: () => {
        restoredAgentVisibilityGate.notifyReplayWriteCommitted()
      },
      onRevealed: restoredAgentVisibilityGate.revealAfterHydration,
      isDisposed: () => isDisposed,
    })
    protectRestoredVisibleBaseline = hydrationRouter.protectHydratedVisibleBaseline
    const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
      openCodeThemeBridge?.handlePtyOutputChunk(event.data)
      if (diagnosticsEnabled) {
        terminalDiagnostics.log('pty-data', {
          seq: event.seq ?? null,
          dataLength: event.data.length,
          dataStartsWithEsc: event.data.startsWith('\u001b'),
          dataHeadHex: formatTerminalDataHeadHex(event.data),
          containsDestructive: containsDestructiveTerminalDisplayControlSequence(event.data),
          shouldDeferHydratedRedraw: shouldDeferHydratedTerminalRedrawChunk(event.data),
        })
      }
      restoredAgentVisibilityGate.notifyOutputObserved(event.data)
      hydrationRouter.handleDataChunk(event.data, { seq: event.seq ?? null })
    })
    const unsubscribeExit = ptyEventHub.onSessionExit(sessionId, event => {
      hydrationRouter.handleExit(event.exitCode)
    })
    const unsubscribeGeometry = ptyEventHub.onSessionGeometry(sessionId, event => {
      lastCommittedPtySizeRef.current = {
        cols: event.cols,
        rows: event.rows,
      }
      if (terminal.cols !== event.cols || terminal.rows !== event.rows) {
        terminal.resize(event.cols, event.rows)
      }
      syncTerminalSize()
      scheduleTranscriptSync()
    })
    const unsubscribeResync = ptyEventHub.onSessionResync(sessionId, event => {
      requestTerminalRendererRecovery({
        reason: 'stream_resync',
        trigger: event.reason === 'replay_window_exceeded' ? 'resync_event' : 'resync_event',
        forceDom: false,
      })
    })
    const shouldSkipInitialPlaceholderWrite =
      hasPreservedVisibleBaseline && hasVisibleTerminalBufferContent(terminal)
    startRuntimeTerminalHydration({
      attachPromise,
      sessionId,
      terminal,
      kind,
      isLiveSessionReattach,
      shouldSkipInitialPlaceholderWrite,
      cachedScreenState,
      scrollbackBuffer,
      committedScrollbackBuffer,
      committedScreenStateRecorder,
      scheduleTranscriptSync,
      presentationSnapshotPromise,
      hydrationBaselineSourceRef,
      lastCommittedPtySizeRef,
      runtimeInputBridge,
      hydrationRouter,
      shouldGateInitialUserInput,
      shouldAwaitAgentVisibleOutput,
      isDisposed: () => isDisposed,
    })
    const disposeRuntimeRendererAndThemeSync = registerRuntimeRendererAndThemeSync({
      terminal,
      renderer: session.renderer,
      containerRef,
      activeRendererKindRef,
      isTerminalHydratedRef,
      syncTerminalSize,
      scheduleWebglPixelSnapping,
      log: terminalDiagnostics.log,
      requestRecovery: requestTerminalRendererRecovery,
      terminalThemeMode,
      applyTerminalTheme,
      reportOpenCodeThemeMode: () => {
        openCodeThemeBridge?.reportThemeMode()
      },
    })
    return () => {
      if (testEnvironmentAutoFocusFrame !== null) {
        window.cancelAnimationFrame(testEnvironmentAutoFocusFrame)
      }
      suppressPtyResizeRef.current = false
      const isInvalidated = isCachedTerminalScreenStateInvalidated(nodeId, sessionId)
      if (kind !== 'agent') {
        cacheTerminalScreenStateOnUnmount({
          nodeId,
          isInvalidated,
          isTerminalHydrated: isTerminalHydratedRef.current,
          hasPendingWrites: outputScheduler.hasPendingWrites(),
          rawSnapshot: scrollbackBuffer.snapshot(),
          resolveCommittedScreenState: committedScreenStateRecorder.resolve,
        })
      }
      isDisposed = true
      disposeRuntimeRendererAndThemeSync()
      disposeInteractionWindow()
      unsubscribeData()
      unsubscribeExit()
      unsubscribeGeometry()
      unsubscribeResync()
      restoredAgentVisibilityGate.dispose()
      outputScheduler.dispose()
      outputSchedulerRef.current = null
      disposeRuntimeTestHandles()
      runtimeInputBridge.dispose()
      pendingUserInputBuffer.length = 0
      openCodeThemeBridge?.dispose()
      if (isInvalidated) {
        cancelScrollbackPublish()
        clearCachedTerminalScreenStateInvalidation(nodeId, sessionId)
      } else {
        disposeScrollbackPublish()
      }
      session.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      activeRendererKindRef.current = 'dom'
      cancelWebglPixelSnapping()
    }
  }, [
    cancelScrollbackPublish,
    applyTerminalTheme,
    bindSearchAddonToFind,
    nodeId,
    disposeScrollbackPublish,
    markScrollbackDirty,
    openTerminalFind,
    scrollbackBufferRef,
    scheduleTranscriptSync,
    scheduleWebglPixelSnapping,
    cancelWebglPixelSnapping,
    setRendererKindAndApply,
    activeRendererKindRef,
    sessionId,
    syncTerminalSize,
    terminalThemeMode,
    terminalProvider,
    isTestEnvironment,
    kind,
    agentLaunchModeRef,
    agentResumeSessionIdVerifiedRef,
    titleRef,
    outputSchedulerRef,
    isViewportInteractionActiveRef,
    isPointerResizingRef,
    suppressPtyResizeRef,
    lastCommittedPtySizeRef,
    commandInputStateRef,
    onCommandRunRef,
    terminalRef,
    fitAddonRef,
    containerRef,
    isTerminalHydratedRef,
    setIsTerminalHydrated,
    shouldRestoreTerminalFocusRef,
    preservedXtermSessionRef,
    recentUserInteractionAtRef,
    pendingUserInputBufferRef,
    isLiveSessionReattach,
    terminalFontSize,
    viewportZoomRef,
    preferredRendererMode,
    terminalClientResetVersion,
    requestTerminalRendererRecovery,
  ])
}
