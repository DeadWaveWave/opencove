import { useEffect } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { AgentLaunchMode, AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { createRollingTextBuffer } from '../../utils/rollingTextBuffer'
import type { TerminalCommandInputState } from './commandInput'
import { createRuntimeTerminalInputBridge } from './createRuntimeTerminalInputBridge'
import { registerTerminalLayoutSync } from './layoutSync'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
} from './screenStateCache'
import { resolveAttachablePtyApi } from './attachablePty'
import { cacheTerminalScreenStateOnUnmount } from './cacheTerminalScreenState'
import type { TerminalThemeMode } from './theme'
import { MAX_SCROLLBACK_CHARS } from './constants'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { createTerminalOutputScheduler, type TerminalOutputScheduler } from './outputScheduler'
import { hydrateTerminalFromSnapshot } from './hydrateFromSnapshot'
import { createCommittedScreenStateRecorder } from './committedScreenState'
import { createTerminalHydrationRouter } from './hydrationRouter'
import { createOpenCodeTuiThemeBridge } from './opencodeTuiThemeBridge'
import { createMountedXtermSession } from './xtermSession'
import { registerWebglPixelSnappingMutationObserver } from './registerWebglPixelSnappingMutationObserver'
import type { TerminalRendererKind } from './useWebglPixelSnappingScheduler'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import type { XtermSession } from './xtermSession'
import {
  hasRecentTerminalUserInteraction,
  registerTerminalUserInteractionWindow,
} from './userInteractionWindow'

const RESTORED_AGENT_INPUT_GATE_DELAY_MS = 1_000

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
}: {
  nodeId: string
  sessionId: string
  kind: WorkspaceNodeKind
  terminalProvider: AgentProvider | null
  agentLaunchModeRef: { current: AgentLaunchMode | null }
  agentResumeSessionIdVerifiedRef: { current: boolean }
  statusRef: { current: AgentRuntimeStatus | null }
  titleRef: { current: string }
  terminalThemeMode: TerminalThemeMode
  isTestEnvironment: boolean
  containerRef: { current: HTMLDivElement | null }
  terminalRef: { current: Terminal | null }
  fitAddonRef: { current: FitAddon | null }
  outputSchedulerRef: { current: TerminalOutputScheduler | null }
  isViewportInteractionActiveRef: { current: boolean }
  suppressPtyResizeRef: { current: boolean }
  commandInputStateRef: { current: TerminalCommandInputState }
  onCommandRunRef: { current: ((command: string) => void) | undefined }
  scrollbackBufferRef: {
    current: {
      snapshot: () => string
      set: (snapshot: string) => void
      append: (data: string) => void
    }
  }
  markScrollbackDirty: (immediate?: boolean) => void
  scheduleTranscriptSync: () => void
  cancelScrollbackPublish: () => void
  disposeScrollbackPublish: () => void
  syncTerminalSize: () => void
  applyTerminalTheme: () => void
  bindSearchAddonToFind: (addon: SearchAddon) => () => void
  openTerminalFind: () => void
  isTerminalHydratedRef: { current: boolean }
  setIsTerminalHydrated: (hydrated: boolean) => void
  shouldRestoreTerminalFocusRef: { current: boolean }
  preservedXtermSessionRef: { current: XtermSession | null }
  recentUserInteractionAtRef: { current: number }
  pendingUserInputBufferRef: {
    current: Array<{ data: string; encoding: 'utf8' | 'binary' }>
  }
  isLiveSessionReattach: boolean
  activeRendererKindRef: { current: TerminalRendererKind }
  scheduleWebglPixelSnapping: () => void
  cancelWebglPixelSnapping: () => void
  setRendererKindAndApply: (kind: TerminalRendererKind) => void
  terminalFontSize: number
}): void {
  useEffect(() => {
    if (sessionId.trim().length === 0) {
      return undefined
    }

    const ptyWithOptionalAttach = resolveAttachablePtyApi()
    const cachedScreenState = getCachedTerminalScreenState(nodeId, sessionId)
    suppressPtyResizeRef.current = Boolean(cachedScreenState?.serialized.includes('\u001b[?1049h'))
    const initialDimensions = resolveInitialTerminalDimensions(cachedScreenState)
    const scrollbackBuffer = scrollbackBufferRef.current
    const persistedSnapshot = scrollbackBuffer.snapshot()
    const shouldGateInitialUserInput =
      kind === 'agent' &&
      !isLiveSessionReattach &&
      cachedScreenState === null &&
      persistedSnapshot.trim().length > 0
    const shouldProtectRestoredAgentHistory = (): boolean =>
      kind === 'agent' &&
      !isLiveSessionReattach &&
      cachedScreenState === null &&
      (agentResumeSessionIdVerifiedRef.current === true ||
        agentLaunchModeRef.current === 'resume' ||
        scrollbackBuffer.snapshot().trim().length > 0)
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
    const session =
      preservedSession ??
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
      })
    if (preservedSession) {
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
    const disposePositionObserver = registerWebglPixelSnappingMutationObserver({
      container: containerRef.current,
      isWebglRenderer: () => activeRendererKindRef.current === 'webgl',
      scheduleWebglPixelSnapping,
    })
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

    let testEnvironmentAutoFocusFrame: number | null = null
    if (isTestEnvironment && containerRef.current) {
      testEnvironmentAutoFocusFrame = window.requestAnimationFrame(() => {
        const activeElement =
          document.activeElement instanceof Element ? document.activeElement : null
        const activeTerminalScope =
          activeElement?.closest('[data-cove-focus-scope="terminal"]') ?? null
        const shouldAutoFocusTerminal =
          !activeElement ||
          activeElement === document.body ||
          activeElement === document.documentElement ||
          activeTerminalScope === containerRef.current

        if (shouldAutoFocusTerminal) {
          terminal.focus()
        }

        scheduleTranscriptSync()
      })
    }
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
    const { ptyWriteQueue } = runtimeInputBridge
    const openCodeThemeBridge =
      terminalProvider === 'opencode'
        ? createOpenCodeTuiThemeBridge({ terminal, ptyWriteQueue, terminalThemeMode })
        : null
    let isDisposed = false
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
    const hydrationRouter = createTerminalHydrationRouter({
      terminal,
      outputScheduler,
      shouldReplaceAgentPlaceholderAfterHydration: shouldProtectRestoredAgentHistory,
      shouldDeferHydratedRedrawChunks: shouldProtectRestoredAgentHistory,
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
      hydrationRouter.handleDataChunk(event.data)
    })
    const unsubscribeExit = ptyEventHub.onSessionExit(sessionId, event => {
      hydrationRouter.handleExit(event.exitCode)
    })
    const attachPromise = Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId }))
    void hydrateTerminalFromSnapshot({
      attachPromise,
      sessionId,
      terminal,
      kind: kind === 'agent' ? 'agent' : 'terminal',
      useLivePtySnapshotDuringHydration: kind !== 'agent' || isLiveSessionReattach,
      skipInitialPlaceholderWrite: preservedSession !== null,
      cachedScreenState,
      persistedSnapshot: scrollbackBuffer.snapshot(),
      takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
      isDisposed: () => isDisposed,
      onHydratedWriteCommitted: rawSnapshot => {
        committedScrollbackBuffer.set(rawSnapshot)
        committedScreenStateRecorder.record(rawSnapshot)
        scheduleTranscriptSync()
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
          }, RESTORED_AGENT_INPUT_GATE_DELAY_MS)
          return
        }

        runtimeInputBridge.releaseBufferedUserInput()
      },
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
      session.renderer.clearTextureAtlas()
      syncTerminalSize()
      openCodeThemeBridge?.reportThemeMode()
    }
    window.addEventListener('opencove-theme-changed', handleThemeChange)
    const clearPendingUserInputBuffer = (): void => {
      pendingUserInputBufferRef.current.length = 0
    }
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
      disposeLayoutSync()
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
      resizeObserver.disconnect()
      disposeInteractionWindow()
      unsubscribeData()
      unsubscribeExit()
      outputScheduler.dispose()
      outputSchedulerRef.current = null
      runtimeInputBridge.dispose()
      clearPendingUserInputBuffer()
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
      disposePositionObserver()
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
  ])
}
