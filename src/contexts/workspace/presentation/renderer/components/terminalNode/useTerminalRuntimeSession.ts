import { useEffect } from 'react'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { createRollingTextBuffer } from '../../utils/rollingTextBuffer'
import { createRuntimeTerminalInputBridge } from './createRuntimeTerminalInputBridge'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
} from './screenStateCache'
import { resolveAttachablePtyApi } from './attachablePty'
import { cacheTerminalScreenStateOnUnmount } from './cacheTerminalScreenState'
import { MAX_SCROLLBACK_CHARS } from './constants'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { createTerminalOutputScheduler } from './outputScheduler'
import { hydrateTerminalFromSnapshot } from './hydrateFromSnapshot'
import {
  containsDestructiveTerminalDisplayControlSequence,
  shouldDeferHydratedTerminalRedrawChunk,
} from './hydrationReplacement'
import { createCommittedScreenStateRecorder } from './committedScreenState'
import { createTerminalHydrationRouter } from './hydrationRouter'
import { createMountedXtermSession } from './xtermSession'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import { registerTerminalBinaryInputTestHandle } from './testHarness'
import type { TerminalRuntimeSessionOptions } from './useTerminalRuntimeSession.types'
import {
  formatTerminalDataHeadHex,
  hasVisibleTerminalBufferContent,
} from './terminalRuntimeDiagnostics'
import {
  hasRecentTerminalUserInteraction,
  markRecentTerminalUserInteraction,
  registerTerminalUserInteractionWindow,
} from './userInteractionWindow'
import {
  attachAfterPresentationSnapshot,
  createOptionalOpenCodeThemeBridge,
  shouldReusePreservedXtermSession,
  scheduleTestEnvironmentTerminalAutoFocus,
  requestPresentationSnapshot,
  registerRuntimeRendererAndThemeSync,
  shouldGateRestoredAgentInput,
  shouldProtectHydratedAgentHistory,
  shouldTreatHydratedAgentBaselineAsPlaceholder,
  type TerminalHydrationBaselineSource,
} from './useTerminalRuntimeSession.support'

export function useTerminalRuntimeSession({
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
    if (sessionId.trim().length === 0) {
      return undefined
    }

    // Wait until the inner terminal div ref is attached
    if (!containerRef.current) {
      return undefined
    }

    const ptyWithOptionalAttach = resolveAttachablePtyApi()
    const cachedScreenState = getCachedTerminalScreenState(nodeId, sessionId)
    suppressPtyResizeRef.current = Boolean(cachedScreenState?.serialized.includes('\u001b[?1049h'))
    const initialDimensions = resolveInitialTerminalDimensions(cachedScreenState)
    const scrollbackBuffer = scrollbackBufferRef.current
    const pendingUserInputBuffer = pendingUserInputBufferRef.current
    const persistedSnapshot = scrollbackBuffer.snapshot()
    const shouldGateInitialUserInput = shouldGateRestoredAgentInput({
      kind,
      isLiveSessionReattach,
      persistedSnapshot,
    })
    const committedScrollbackBuffer = createRollingTextBuffer({
      maxChars: MAX_SCROLLBACK_CHARS,
      initial: persistedSnapshot,
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
    const disposeBinaryInputTestHandle = isTestEnvironment
      ? registerTerminalBinaryInputTestHandle(nodeId, data => {
          markRecentTerminalUserInteraction(recentUserInteractionAtRef)
          ptyWriteQueue.enqueue(data, 'binary')
          ptyWriteQueue.flush()
          return true
        })
      : () => undefined
    const openCodeThemeBridge = createOptionalOpenCodeThemeBridge({
      terminalProvider,
      terminal,
      ptyWriteQueue,
      terminalThemeMode,
    })
    let isDisposed = false
    const ptyEventHub = getPtyEventHub()
    const hydrationBaselineSourceRef: { current: TerminalHydrationBaselineSource } = {
      current:
        preservedSession !== null ||
        cachedScreenState?.serialized.length ||
        persistedSnapshot.trim().length > 0
          ? 'placeholder_snapshot'
          : 'empty',
    }
    const presentationSnapshotPromise = requestPresentationSnapshot(sessionId)
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
    const hydrationRouter = createTerminalHydrationRouter({
      terminal,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: () =>
        shouldTreatHydratedAgentBaselineAsPlaceholder({
          kind,
          agentResumeSessionIdVerified: agentResumeSessionIdVerifiedRef.current === true,
          agentLaunchMode: agentLaunchModeRef.current,
          persistedSnapshot: scrollbackBuffer.snapshot(),
          baselineSource: hydrationBaselineSourceRef.current,
        }),
      shouldDeferHydratedRedrawChunks: () =>
        hasPreservedVisibleBaseline ||
        hasVisibleTerminalBufferContent(terminal) ||
        shouldProtectHydratedAgentHistory({
          kind,
          agentResumeSessionIdVerified: agentResumeSessionIdVerifiedRef.current === true,
          agentLaunchMode: agentLaunchModeRef.current,
          persistedSnapshot: scrollbackBuffer.snapshot(),
        }),
      hasRecentUserInteraction: () => hasRecentTerminalUserInteraction(recentUserInteractionAtRef),
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
      onRevealed: () => {
        if (!isDisposed) {
          isTerminalHydratedRef.current = true
          setIsTerminalHydrated(true)
          scheduleTranscriptSync()
          openCodeThemeBridge?.reportThemeMode()
        }
      },
      isDisposed: () => isDisposed,
    })
    const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
      openCodeThemeBridge?.handlePtyOutputChunk(event.data)
      if (diagnosticsEnabled) {
        terminalDiagnostics.log('pty-data', {
          dataLength: event.data.length,
          dataStartsWithEsc: event.data.startsWith('\u001b'),
          dataHeadHex: formatTerminalDataHeadHex(event.data),
          containsDestructive: containsDestructiveTerminalDisplayControlSequence(event.data),
          shouldDeferHydratedRedraw: shouldDeferHydratedTerminalRedrawChunk(event.data),
        })
      }
      hydrationRouter.handleDataChunk(event.data)
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
    const attachPromise = attachAfterPresentationSnapshot({
      ptyApi: ptyWithOptionalAttach,
      sessionId,
      presentationSnapshotPromise,
    })
    const shouldSkipInitialPlaceholderWrite =
      hasPreservedVisibleBaseline && hasVisibleTerminalBufferContent(terminal)
    void hydrateTerminalFromSnapshot({
      attachPromise,
      sessionId,
      terminal,
      kind: kind === 'agent' ? 'agent' : 'terminal',
      useLivePtySnapshotDuringHydration: kind !== 'agent' || isLiveSessionReattach,
      skipInitialPlaceholderWrite: shouldSkipInitialPlaceholderWrite,
      cachedScreenState,
      persistedSnapshot: scrollbackBuffer.snapshot(),
      presentationSnapshotPromise,
      takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
      isDisposed: () => isDisposed,
      onHydratedWriteCommitted: rawSnapshot => {
        committedScrollbackBuffer.set(rawSnapshot)
        committedScreenStateRecorder.record(rawSnapshot)
        scheduleTranscriptSync()
      },
      onHydrationBaselineResolved: source => {
        hydrationBaselineSourceRef.current = source
      },
      onPresentationSnapshotAccepted: snapshot => {
        lastCommittedPtySizeRef.current = {
          cols: snapshot.cols,
          rows: snapshot.rows,
        }
      },
      finalizeHydration: rawSnapshot => {
        runtimeInputBridge.enableTerminalDataForwarding()
        hydrationRouter.finalizeHydration(rawSnapshot)
        if (shouldGateInitialUserInput) {
          window.setTimeout(() => {
            if (isDisposed) {
              return
            }
            runtimeInputBridge.releaseBufferedUserInput()
          }, 1_000)
          return
        }
        runtimeInputBridge.releaseBufferedUserInput()
      },
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
      cacheTerminalScreenStateOnUnmount({
        nodeId,
        isInvalidated,
        isTerminalHydrated: isTerminalHydratedRef.current,
        hasPendingWrites: outputScheduler.hasPendingWrites(),
        rawSnapshot: scrollbackBuffer.snapshot(),
        resolveCommittedScreenState: committedScreenStateRecorder.resolve,
      })
      isDisposed = true
      disposeRuntimeRendererAndThemeSync()
      disposeInteractionWindow()
      unsubscribeData()
      unsubscribeExit()
      unsubscribeGeometry()
      unsubscribeResync()
      outputScheduler.dispose()
      outputSchedulerRef.current = null
      disposeBinaryInputTestHandle()
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
    statusRef,
    titleRef,
    outputSchedulerRef,
    isViewportInteractionActiveRef,
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
