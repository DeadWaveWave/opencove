import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from '@xyflow/react'
import { SerializeAddon } from '@xterm/addon-serialize'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { createRollingTextBuffer } from '../utils/rollingTextBuffer'
import {
  createTerminalCommandInputState,
  parseTerminalCommandInput,
} from './terminalNode/commandInput'
import { createPtyWriteQueue, handleTerminalCustomKeyEvent } from './terminalNode/inputBridge'
import { registerTerminalLayoutSync } from './terminalNode/layoutSync'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
  setCachedTerminalScreenState,
} from './terminalNode/screenStateCache'
import { syncTerminalNodeSize } from './terminalNode/syncTerminalNodeSize'
import { resolveTerminalNodeFrameStyle } from './terminalNode/nodeFrameStyle'
import { resolveTerminalTheme, resolveTerminalUiTheme } from './terminalNode/theme'
import { registerTerminalSelectionTestHandle } from './terminalNode/testHarness'
import { patchXtermMouseServiceWithRetry } from './terminalNode/patchXtermMouseService'
import { finalizeTerminalHydration } from './terminalNode/finalizeHydration'
import { registerTerminalDiagnostics } from './terminalNode/registerDiagnostics'
import { useTerminalThemeApplier } from './terminalNode/useTerminalThemeApplier'
import { useTerminalBodyClickFallback } from './terminalNode/useTerminalBodyClickFallback'
import { useTerminalFind } from './terminalNode/useTerminalFind'
import { useTerminalResize } from './terminalNode/useTerminalResize'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import { createCommittedScreenStateRecorder } from './terminalNode/committedScreenState'
import { MAX_SCROLLBACK_CHARS } from './terminalNode/constants'
import { resolveInitialTerminalDimensions } from './terminalNode/initialDimensions'
import { createTerminalOutputScheduler } from './terminalNode/outputScheduler'
import { hydrateTerminalFromSnapshot } from './terminalNode/hydrateFromSnapshot'
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
  const outputSchedulerRef = useRef<ReturnType<typeof createTerminalOutputScheduler> | null>(null)
  const isViewportInteractionActiveRef = useRef(isViewportInteractionActive)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isPointerResizingRef = useRef(false)
  const lastSyncedPtySizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const commandInputStateRef = useRef(createTerminalCommandInputState())
  const onCommandRunRef = useRef(onCommandRun)
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
  useEffect(() => {
    onCommandRunRef.current = onCommandRun
  }, [onCommandRun])
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
    commandInputStateRef.current = createTerminalCommandInputState()
    isTerminalHydratedRef.current = false
    setIsTerminalHydrated(false)
  }, [sessionId])

  const syncTerminalSize = useCallback(() => {
    syncTerminalNodeSize({
      terminalRef,
      fitAddonRef,
      containerRef,
      isPointerResizingRef,
      lastSyncedPtySizeRef,
      sessionId,
    })
  }, [sessionId])
  const applyTerminalTheme = useTerminalThemeApplier({
    terminalRef,
    containerRef,
    terminalThemeMode,
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

    const ptyWithOptionalAttach = window.opencoveApi.pty as typeof window.opencoveApi.pty & {
      attach?: (payload: { sessionId: string }) => Promise<void>
      detach?: (payload: { sessionId: string }) => Promise<void>
    }
    const cachedScreenState = getCachedTerminalScreenState(nodeId, sessionId)
    const initialDimensions = resolveInitialTerminalDimensions(cachedScreenState)
    const scrollbackBuffer = scrollbackBufferRef.current
    const committedScrollbackBuffer = createRollingTextBuffer({
      maxChars: MAX_SCROLLBACK_CHARS,
      initial: scrollbackBuffer.snapshot(),
    })
    const initialTerminalTheme = resolveTerminalTheme(terminalThemeMode)
    const resolvedTerminalUiTheme = resolveTerminalUiTheme(terminalThemeMode)
    const windowsPty = window.opencoveApi.meta?.windowsPty ?? null
    const diagnosticsEnabled = window.opencoveApi.meta?.enableTerminalDiagnostics === true
    const logTerminalDiagnostics =
      window.opencoveApi.debug?.logTerminalDiagnostics ?? (() => undefined)
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    const terminalSupportsSearch =
      typeof (terminal as unknown as { onWriteParsed?: unknown }).onWriteParsed === 'function'
    const disposeTerminalFind = terminalSupportsSearch
      ? (() => {
          const searchAddon = new SearchAddon()
          terminal.loadAddon(searchAddon)
          return bindSearchAddonToFind(searchAddon)
        })()
      : () => undefined
    let disposeTerminalSelectionTestHandle: () => void = () => undefined
    const ptyWriteQueue = createPtyWriteQueue(({ data, encoding }) =>
      window.opencoveApi.pty.write({
        sessionId,
        data,
        ...(encoding === 'binary' ? { encoding } : {}),
      }),
    )
    terminal.attachCustomKeyEventHandler(event =>
      handleTerminalCustomKeyEvent({
        event,
        ptyWriteQueue,
        terminal,
        onOpenFind: openTerminalFind,
      }),
    )
    let cancelMouseServicePatch: () => void = () => undefined
    if (containerRef.current) {
      terminal.open(containerRef.current)
      containerRef.current.setAttribute('data-cove-terminal-theme', resolvedTerminalUiTheme)
      cancelMouseServicePatch = patchXtermMouseServiceWithRetry(terminal)
      if (window.opencoveApi.meta.isTest) {
        disposeTerminalSelectionTestHandle = registerTerminalSelectionTestHandle(nodeId, terminal)
      }
      requestAnimationFrame(syncTerminalSize)
      if (window.opencoveApi.meta.isTest) {
        terminal.focus()
      }
    }
    const terminalDiagnostics = registerTerminalDiagnostics({
      enabled: diagnosticsEnabled,
      emit: logTerminalDiagnostics,
      nodeId,
      sessionId,
      nodeKind: kind === 'agent' ? 'agent' : 'terminal',
      title,
      terminal,
      container: containerRef.current,
      terminalThemeMode,
      windowsPty,
    })

    let isDisposed = false
    let shouldForwardTerminalData = false
    const dataDisposable = terminal.onData(data => {
      if (!shouldForwardTerminalData) {
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
      if (!shouldForwardTerminalData) {
        return
      }

      ptyWriteQueue.enqueue(data, 'binary')
      ptyWriteQueue.flush()
    })

    let isHydrating = true
    const bufferedDataChunks: string[] = []
    let bufferedExitCode: number | null = null
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
      },
    })
    outputSchedulerRef.current = outputScheduler
    outputScheduler.onViewportInteractionActiveChange(isViewportInteractionActiveRef.current)

    const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
      if (isHydrating) {
        bufferedDataChunks.push(event.data)
        return
      }

      outputScheduler.handleChunk(event.data)
    })

    const unsubscribeExit = ptyEventHub.onSessionExit(sessionId, event => {
      if (isHydrating) {
        bufferedExitCode = event.exitCode
        return
      }

      const exitMessage = `\r\n[process exited with code ${event.exitCode}]\r\n`
      outputScheduler.handleChunk(exitMessage, { immediateScrollbackPublish: true })
    })

    const attachPromise = Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId }))

    const finalizeHydration = (rawSnapshot: string): void => {
      isHydrating = false
      finalizeTerminalHydration({
        isDisposed: () => isDisposed,
        rawSnapshot,
        scrollbackBuffer,
        ptyWriteQueue,
        bufferedDataChunks,
        bufferedExitCode,
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
          }
        },
      })
      bufferedExitCode = null
    }

    void hydrateTerminalFromSnapshot({
      attachPromise,
      sessionId,
      terminal,
      cachedScreenState,
      persistedSnapshot: scrollbackBuffer.snapshot(),
      takePtySnapshot: payload => window.opencoveApi.pty.snapshot(payload),
      isDisposed: () => isDisposed,
      onHydratedWriteCommitted: rawSnapshot => {
        committedScrollbackBuffer.set(rawSnapshot)
        committedScreenStateRecorder.record(rawSnapshot)
      },
      finalizeHydration: rawSnapshot => {
        shouldForwardTerminalData = true
        finalizeHydration(rawSnapshot)
      },
    })

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalSize()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }
    const disposeLayoutSync = registerTerminalLayoutSync(syncTerminalSize)

    const handleThemeChange = () => {
      if (terminalThemeMode !== 'sync-with-ui') {
        return
      }
      applyTerminalTheme()
      syncTerminalSize()
    }
    window.addEventListener('opencove-theme-changed', handleThemeChange)

    return () => {
      const isInvalidated = isCachedTerminalScreenStateInvalidated(nodeId, sessionId)

      const hasPendingWrites = outputScheduler.hasPendingWrites()

      if (!isInvalidated && isTerminalHydratedRef.current && !hasPendingWrites) {
        const latestCommittedScreenState = committedScreenStateRecorder.resolve(
          scrollbackBuffer.snapshot(),
        )
        if (latestCommittedScreenState) {
          setCachedTerminalScreenState(nodeId, {
            sessionId: latestCommittedScreenState.sessionId,
            serialized: latestCommittedScreenState.serialized,
            rawSnapshot: latestCommittedScreenState.rawSnapshot,
            cols: latestCommittedScreenState.cols,
            rows: latestCommittedScreenState.rows,
          })
        }
      }

      cancelMouseServicePatch()
      isDisposed = true
      const detachPromise = ptyWithOptionalAttach.detach?.({ sessionId })
      void detachPromise?.catch(() => undefined)
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
    sessionId,
    syncTerminalSize,
    terminalThemeMode,
    title,
    kind,
  ])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    terminal.options.fontSize = terminalFontSize
    syncTerminalSize()
  }, [syncTerminalSize, terminalFontSize])

  useEffect(() => {
    const frame = requestAnimationFrame(syncTerminalSize)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [height, syncTerminalSize, width])

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
