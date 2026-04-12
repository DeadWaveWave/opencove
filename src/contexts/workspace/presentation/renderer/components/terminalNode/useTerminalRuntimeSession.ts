import { useEffect } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import type { AgentLaunchMode, AgentRuntimeStatus, WorkspaceNodeKind } from '../../types'
import type { AgentProvider } from '@contexts/settings/domain/agentSettings'
import { createRollingTextBuffer } from '../../utils/rollingTextBuffer'
import { parseTerminalCommandInput, type TerminalCommandInputState } from './commandInput'
import { createPtyWriteQueue, handleTerminalCustomKeyEvent } from './inputBridge'
import { registerTerminalLayoutSync } from './layoutSync'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
} from './screenStateCache'
import { resolveAttachablePtyApi } from './attachablePty'
import { cacheTerminalScreenStateOnUnmount } from './cacheTerminalScreenState'
import { resolveTerminalTheme, resolveTerminalUiTheme, type TerminalThemeMode } from './theme'
import { registerTerminalSelectionTestHandle } from './testHarness'
import { patchXtermMouseServiceWithRetry } from './patchXtermMouseService'
import { finalizeTerminalHydration } from './finalizeHydration'
import { registerTerminalDiagnostics } from './registerDiagnostics'
import { activatePreferredTerminalRenderer } from './preferredRenderer'
import { registerTerminalHitTargetCursorScope } from './hitTargetCursorScope'
import { DEFAULT_TERMINAL_FONT_FAMILY, MAX_SCROLLBACK_CHARS } from './constants'
import { resolveInitialTerminalDimensions } from './initialDimensions'
import { createTerminalOutputScheduler, type TerminalOutputScheduler } from './outputScheduler'
import { hydrateTerminalFromSnapshot } from './hydrateFromSnapshot'
import { createCommittedScreenStateRecorder } from './committedScreenState'

export function useTerminalRuntimeSession({
  nodeId,
  sessionId,
  kind,
  terminalProvider,
  agentLaunchModeRef,
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
}: {
  nodeId: string
  sessionId: string
  kind: WorkspaceNodeKind
  terminalProvider: AgentProvider | null
  agentLaunchModeRef: { current: AgentLaunchMode | null }
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
    const committedScrollbackBuffer = createRollingTextBuffer({
      maxChars: MAX_SCROLLBACK_CHARS,
      initial: scrollbackBuffer.snapshot(),
    })
    const initialTerminalTheme = resolveTerminalTheme(terminalThemeMode)
    const resolvedTerminalUiTheme = resolveTerminalUiTheme(terminalThemeMode)
    const windowsPty = window.opencoveApi.meta?.windowsPty ?? null
    const inputDiagnosticsEnabled = window.opencoveApi.meta?.enableTerminalInputDiagnostics === true
    const diagnosticsEnabled =
      window.opencoveApi.meta?.enableTerminalDiagnostics === true || inputDiagnosticsEnabled
    const logTerminalDiagnostics =
      window.opencoveApi.debug?.logTerminalDiagnostics ?? (() => undefined)
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      theme: initialTerminalTheme,
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
      ...(windowsPty ? { windowsPty } : {}),
      ...(initialDimensions ?? {}),
    })
    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(serializeAddon)
    let activeRenderer = activatePreferredTerminalRenderer(terminal, terminalProvider)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    const disposeTerminalFind =
      typeof (terminal as unknown as { onWriteParsed?: unknown }).onWriteParsed === 'function'
        ? (() => {
            const searchAddon = new SearchAddon()
            terminal.loadAddon(searchAddon)
            return bindSearchAddonToFind(searchAddon)
          })()
        : () => undefined
    let disposeTerminalSelectionTestHandle: () => void = () => undefined
    let cancelMouseServicePatch: () => void = () => undefined
    let disposeTerminalHitTargetCursorScope: () => void = () => undefined
    if (containerRef.current) {
      terminal.open(containerRef.current)
      containerRef.current.setAttribute('data-cove-terminal-theme', resolvedTerminalUiTheme)
      cancelMouseServicePatch = patchXtermMouseServiceWithRetry(terminal)
      disposeTerminalHitTargetCursorScope = registerTerminalHitTargetCursorScope({
        container: containerRef.current,
        ownerId: `${nodeId}:${sessionId}`,
      })
      if (isTestEnvironment) {
        disposeTerminalSelectionTestHandle = registerTerminalSelectionTestHandle(nodeId, terminal)
      }
      activeRenderer.clearTextureAtlas()
      syncTerminalSize()
      requestAnimationFrame(syncTerminalSize)
      if (isTestEnvironment) {
        terminal.focus()
        scheduleTranscriptSync()
      }
    }
    const terminalDiagnostics = registerTerminalDiagnostics({
      enabled: diagnosticsEnabled,
      emit: logTerminalDiagnostics,
      nodeId,
      sessionId,
      nodeKind: kind === 'agent' ? 'agent' : 'terminal',
      title: titleRef.current,
      terminal,
      container: containerRef.current,
      rendererKind: activeRenderer.kind,
      terminalThemeMode,
      windowsPty,
    })
    const formatInputHeadHex = (value: string, limit = 12): string => {
      const chars = Array.from(value).slice(0, limit)
      return chars
        .map(char => {
          const codePoint = char.codePointAt(0)
          if (codePoint === undefined) {
            return ''
          }
          return codePoint.toString(16).padStart(2, '0')
        })
        .filter(Boolean)
        .join(' ')
    }
    const ptyWriteQueue = createPtyWriteQueue(async ({ data, encoding }) => {
      if (inputDiagnosticsEnabled) {
        terminalDiagnostics.log('pty-write', {
          encoding,
          dataLength: data.length,
          dataStartsWithEsc: data.startsWith('\u001b'),
          dataHeadHex: formatInputHeadHex(data),
        })
      }

      try {
        await window.opencoveApi.pty.write({
          sessionId,
          data,
          ...(encoding === 'binary' ? { encoding } : {}),
        })
      } catch (error) {
        if (inputDiagnosticsEnabled) {
          terminalDiagnostics.log('pty-write-error', {
            encoding,
            dataLength: data.length,
            message: error instanceof Error ? error.message : String(error),
          })
        }
        throw error
      }
    })
    terminal.attachCustomKeyEventHandler(event =>
      handleTerminalCustomKeyEvent({
        event,
        ptyWriteQueue,
        terminal,
        onOpenFind: openTerminalFind,
      }),
    )
    let isDisposed = false,
      shouldForwardTerminalData = false
    const dataDisposable = terminal.onData(data => {
      if (suppressPtyResizeRef.current) {
        suppressPtyResizeRef.current = false
        syncTerminalSize()
      }

      if (inputDiagnosticsEnabled) {
        terminalDiagnostics.log('xterm-onData', {
          dataLength: data.length,
          dataStartsWithEsc: data.startsWith('\u001b'),
          dataHeadHex: formatInputHeadHex(data),
          shouldForwardTerminalData,
        })
      }

      // During hydration, drop xterm-generated ESC reply sequences but still forward normal typing.
      if (!shouldForwardTerminalData) {
        if (data.startsWith('\u001b')) {
          if (inputDiagnosticsEnabled) {
            terminalDiagnostics.log('xterm-onData-dropped', {
              reason: 'esc-during-hydration',
              dataLength: data.length,
              dataHeadHex: formatInputHeadHex(data),
            })
          }
          return
        }

        ptyWriteQueue.enqueue(data)
        // Forward user typing immediately even while hydrating.
        ptyWriteQueue.flush()
        return
      }

      ptyWriteQueue.enqueue(data)
      ptyWriteQueue.flush()
      const commandRunHandler = onCommandRunRef.current
      if (!commandRunHandler) {
        return
      }
      const parsed = parseTerminalCommandInput(data, commandInputStateRef.current)
      commandInputStateRef.current = parsed.nextState
      parsed.commands.forEach(command => {
        commandRunHandler(command)
      })
    })
    const binaryDisposable = terminal.onBinary(data => {
      if (suppressPtyResizeRef.current) {
        suppressPtyResizeRef.current = false
        syncTerminalSize()
      }

      if (inputDiagnosticsEnabled) {
        terminalDiagnostics.log('xterm-onBinary', {
          dataLength: data.length,
          dataStartsWithEsc: data.startsWith('\u001b'),
          dataHeadHex: formatInputHeadHex(data),
          shouldForwardTerminalData,
        })
      }

      if (!shouldForwardTerminalData) {
        if (data.startsWith('\u001b')) {
          if (inputDiagnosticsEnabled) {
            terminalDiagnostics.log('xterm-onBinary-dropped', {
              reason: 'esc-during-hydration',
              dataLength: data.length,
              dataHeadHex: formatInputHeadHex(data),
            })
          }
          return
        }

        ptyWriteQueue.enqueue(data, 'binary')
        ptyWriteQueue.flush()
        return
      }

      ptyWriteQueue.enqueue(data, 'binary')
      ptyWriteQueue.flush()
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
    const shouldReplaceAgentPlaceholderAfterHydration =
      kind === 'agent' &&
      agentLaunchModeRef.current === 'resume' &&
      (statusRef.current === 'running' ||
        statusRef.current === 'standby' ||
        statusRef.current === 'restoring')
    let shouldReplaceAgentPlaceholderOnNextChunk = false
    const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
      if (isHydrating) {
        hydrationBuffer.dataChunks.push(event.data)
        return
      }

      if (shouldReplaceAgentPlaceholderOnNextChunk) {
        shouldReplaceAgentPlaceholderOnNextChunk = false
        terminal.reset()
        scrollbackBuffer.set('')
        committedScrollbackBuffer.set('')
        committedScreenStateRecorder.record('')
        scheduleTranscriptSync()
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
    const attachPromise = Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId }))
    const finalizeHydration = (rawSnapshot: string): void => {
      isHydrating = false
      const didReplaceBaseline = finalizeTerminalHydration({
        isDisposed: () => isDisposed,
        rawSnapshot,
        replaceHydrationSnapshotWithBufferedOutput: shouldReplaceAgentPlaceholderAfterHydration,
        scrollbackBuffer,
        ptyWriteQueue,
        bufferedDataChunks: hydrationBuffer.dataChunks,
        bufferedExitCode: hydrationBuffer.exitCode,
        terminal,
        committedScrollbackBuffer,
        onCommittedScreenState: nextRawSnapshot => {
          committedScreenStateRecorder.record(nextRawSnapshot)
        },
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
          }
        },
      })

      if (shouldReplaceAgentPlaceholderAfterHydration && !didReplaceBaseline) {
        shouldReplaceAgentPlaceholderOnNextChunk = true
      }
      hydrationBuffer.exitCode = null
    }
    void hydrateTerminalFromSnapshot({
      attachPromise,
      sessionId,
      terminal,
      kind: kind === 'agent' ? 'agent' : 'terminal',
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
        shouldForwardTerminalData = true
        finalizeHydration(rawSnapshot)
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
      activeRenderer.dispose()
      isDisposed = true
      disposeLayoutSync()
      terminalDiagnostics.dispose()
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
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
    sessionId,
    syncTerminalSize,
    terminalThemeMode,
    terminalProvider,
    isTestEnvironment,
    kind,
    agentLaunchModeRef,
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
  ])
}
