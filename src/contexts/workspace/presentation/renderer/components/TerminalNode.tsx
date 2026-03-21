import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Handle, Position, useStore } from '@xyflow/react'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import {
  createTerminalCommandInputState,
  parseTerminalCommandInput,
} from './terminalNode/commandInput'
import { createPtyWriteQueue, handleTerminalCustomKeyEvent } from './terminalNode/inputBridge'
import { registerTerminalLayoutSync } from './terminalNode/layoutSync'
import { mergeScrollbackSnapshots, resolveScrollbackDelta } from './terminalNode/scrollback'
import {
  clearCachedTerminalScreenStateInvalidation,
  getCachedTerminalScreenState,
  isCachedTerminalScreenStateInvalidated,
  setCachedTerminalScreenState,
} from './terminalNode/screenStateCache'
import { TerminalNodeHeader } from './terminalNode/TerminalNodeHeader'
import { syncTerminalNodeSize } from './terminalNode/syncTerminalNodeSize'
import { resolveSuffixPrefixOverlap } from './terminalNode/overlap'
import { resolveTerminalNodeInteraction } from './terminalNode/interaction'
import { resolveTerminalNodeFrameStyle } from './terminalNode/nodeFrameStyle'
import { resolveActiveUiTheme, resolveTerminalTheme } from './terminalNode/theme'
import { registerTerminalSelectionTestHandle } from './terminalNode/testHarness'
import { useTerminalBodyClickFallback } from './terminalNode/useTerminalBodyClickFallback'
import { useTerminalResize } from './terminalNode/useTerminalResize'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import { shouldStopWheelPropagation } from './terminalNode/wheel'
import { resolveInitialTerminalDimensions } from './terminalNode/initialDimensions'
import { revealHydratedTerminal } from './terminalNode/revealHydratedTerminal'
import { createTerminalOutputScheduler } from './terminalNode/outputScheduler'
import {
  selectDragSurfaceSelectionMode,
  selectViewportInteractionActive,
} from './terminalNode/reactFlowState'
import { NodeResizeHandles } from './shared/NodeResizeHandles'
import type { TerminalNodeProps } from './TerminalNode.types'

export function TerminalNode({
  nodeId,
  sessionId,
  title,
  kind,
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
  const applyTerminalTheme = useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    terminal.options.theme = { ...resolveTerminalTheme() }
    containerRef.current?.setAttribute('data-cove-terminal-theme', resolveActiveUiTheme())
    terminal.refresh(0, Math.max(0, terminal.rows - 1))
  }, [])
  const { draftFrame, handleResizePointerDown } = useTerminalResize({
    position,
    width,
    height,
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
    const initialTerminalTheme = resolveTerminalTheme()
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: initialTerminalTheme,
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
      ...(initialDimensions ?? {}),
    })
    const fitAddon = new FitAddon()
    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(serializeAddon)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
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
      }),
    )
    if (containerRef.current) {
      terminal.open(containerRef.current)
      containerRef.current.setAttribute('data-cove-terminal-theme', resolveActiveUiTheme())
      if (window.opencoveApi.meta.isTest) {
        disposeTerminalSelectionTestHandle = registerTerminalSelectionTestHandle(nodeId, terminal)
      }
      requestAnimationFrame(syncTerminalSize)
      if (window.opencoveApi.meta.isTest) {
        terminal.focus()
      }
    }

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

    const outputScheduler = createTerminalOutputScheduler({
      terminal,
      scrollbackBuffer,
      markScrollbackDirty,
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

      const exitMessage = `\\r\\n[process exited with code ${event.exitCode}]\\r\\n`
      outputScheduler.handleChunk(exitMessage, { immediateScrollbackPublish: true })
    })

    const attachPromise = Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId }))

    const finalizeHydration = (rawSnapshot: string): void => {
      if (isDisposed) {
        return
      }

      scrollbackBuffer.set(rawSnapshot)
      isHydrating = false
      ptyWriteQueue.flush()

      const bufferedData = bufferedDataChunks.join('')
      bufferedDataChunks.length = 0

      if (bufferedData.length > 0) {
        const overlap = resolveSuffixPrefixOverlap(rawSnapshot, bufferedData)
        const remainder = bufferedData.slice(overlap)

        if (remainder.length > 0) {
          terminal.write(remainder)
          scrollbackBuffer.append(remainder)
        }
      }

      if (bufferedExitCode !== null) {
        const exitMessage = `\\r\\n[process exited with code ${bufferedExitCode}]\\r\\n`
        bufferedExitCode = null
        terminal.write(exitMessage)
        scrollbackBuffer.append(exitMessage)
      }

      markScrollbackDirty(true)
      revealHydratedTerminal(syncTerminalSize, () => {
        if (!isDisposed) {
          isTerminalHydratedRef.current = true
          setIsTerminalHydrated(true)
        }
      })
    }

    const hydrateFromSnapshot = async () => {
      await attachPromise.catch(() => undefined)

      const persistedSnapshot = scrollbackBuffer.snapshot()
      const cachedSerializedScreen = cachedScreenState?.serialized ?? ''
      const baseRawSnapshot =
        cachedScreenState && cachedScreenState.rawSnapshot.length > 0
          ? cachedScreenState.rawSnapshot
          : persistedSnapshot
      let restoredPayload =
        cachedSerializedScreen.length > 0 ? cachedSerializedScreen : persistedSnapshot
      let rawSnapshot = baseRawSnapshot

      try {
        const snapshot = await window.opencoveApi.pty.snapshot({ sessionId })
        if (cachedSerializedScreen.length > 0) {
          restoredPayload = `${cachedSerializedScreen}${resolveScrollbackDelta(baseRawSnapshot, snapshot.data)}`
          rawSnapshot = mergeScrollbackSnapshots(baseRawSnapshot, snapshot.data)
        } else {
          rawSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
          restoredPayload = rawSnapshot
        }
      } catch {
        rawSnapshot = baseRawSnapshot
      }

      if (isDisposed) {
        return
      }

      if (restoredPayload.length > 0) {
        terminal.write(restoredPayload, () => {
          shouldForwardTerminalData = true
          finalizeHydration(rawSnapshot)
        })
      } else {
        shouldForwardTerminalData = true
        finalizeHydration(rawSnapshot)
      }
    }

    void hydrateFromSnapshot()

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalSize()
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }
    const disposeLayoutSync = registerTerminalLayoutSync(syncTerminalSize)

    const handleThemeChange = () => {
      applyTerminalTheme()
      syncTerminalSize()
    }
    window.addEventListener('opencove-theme-changed', handleThemeChange)

    return () => {
      const isInvalidated = isCachedTerminalScreenStateInvalidated(nodeId, sessionId)

      const hasPendingWrites = outputScheduler.hasPendingWrites()

      if (!isInvalidated && isTerminalHydratedRef.current && !hasPendingWrites) {
        const serializedScreen = serializeAddon.serialize()
        if (serializedScreen.length > 0) {
          setCachedTerminalScreenState(nodeId, {
            sessionId,
            serialized: serializedScreen,
            rawSnapshot: scrollbackBuffer.snapshot(),
            cols: terminal.cols,
            rows: terminal.rows,
          })
        }
      }

      isDisposed = true
      const detachPromise = ptyWithOptionalAttach.detach?.({ sessionId })
      void detachPromise?.catch(() => undefined)
      disposeLayoutSync()
      window.removeEventListener('opencove-theme-changed', handleThemeChange)
      resizeObserver.disconnect()
      dataDisposable.dispose()
      binaryDisposable.dispose()
      unsubscribeData()
      unsubscribeExit()
      disposeTerminalSelectionTestHandle()
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
    nodeId,
    disposeScrollbackPublish,
    markScrollbackDirty,
    scrollbackBufferRef,
    sessionId,
    syncTerminalSize,
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

  const isAgentNode = kind === 'agent'
  const hasSelectedDragSurface = isDragSurfaceSelectionMode && (isSelected || isDragging)
  const {
    consumeIgnoredClick: consumeIgnoredTerminalBodyClick,
    handlePointerDownCapture: handleTerminalBodyPointerDownCapture,
    handlePointerMoveCapture: handleTerminalBodyPointerMoveCapture,
    handlePointerUp: handleTerminalBodyPointerUp,
  } = useTerminalBodyClickFallback(onInteractionStart)

  return (
    <div
      className={`terminal-node nowheel ${hasSelectedDragSurface ? 'terminal-node--selected-surface' : ''}`.trim()}
      style={sizeStyle}
      onPointerDownCapture={handleTerminalBodyPointerDownCapture}
      onPointerMoveCapture={handleTerminalBodyPointerMoveCapture}
      onPointerUp={handleTerminalBodyPointerUp}
      onClickCapture={event => {
        if (event.button !== 0) {
          return
        }

        if (
          event.detail === 2 &&
          event.target instanceof Element &&
          event.target.closest('.terminal-node__header') &&
          !event.target.closest('.nodrag')
        ) {
          return
        }

        if (consumeIgnoredTerminalBodyClick(event.target)) {
          event.stopPropagation()
          return
        }

        const interaction = resolveTerminalNodeInteraction(event.target)
        if (!interaction) {
          return
        }

        event.stopPropagation()
        onInteractionStart?.({
          normalizeViewport: interaction.normalizeViewport,
          selectNode: interaction.selectNode || event.shiftKey,
          shiftKey: event.shiftKey,
        })
      }}
      onWheel={event => {
        if (shouldStopWheelPropagation(event.currentTarget)) {
          event.stopPropagation()
        }
      }}
    >
      <Handle type="target" position={Position.Left} className="workspace-node-handle" />
      <Handle type="source" position={Position.Right} className="workspace-node-handle" />

      <TerminalNodeHeader
        title={title}
        kind={kind}
        status={status}
        directoryMismatch={directoryMismatch}
        onTitleCommit={onTitleCommit}
        onClose={onClose}
        onCopyLastMessage={onCopyLastMessage}
      />

      {isAgentNode && lastError ? <div className="terminal-node__error">{lastError}</div> : null}

      <div
        ref={containerRef}
        className={`terminal-node__terminal nodrag ${isTerminalHydrated ? '' : 'terminal-node__terminal--hydrating'}`.trim()}
        aria-busy={sessionId.trim().length > 0 && isTerminalHydrated ? 'false' : 'true'}
      />
      <NodeResizeHandles
        classNamePrefix="terminal-node"
        testIdPrefix="terminal-resizer"
        handleResizePointerDown={handleResizePointerDown}
      />
    </div>
  )
}
