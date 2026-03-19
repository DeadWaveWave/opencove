import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Handle, Position, useStore } from '@xyflow/react'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getPtyEventHub } from '@app/renderer/shell/utils/ptyEventHub'
import { TERMINAL_LAYOUT_SYNC_EVENT } from './terminalNode/constants'
import {
  createTerminalCommandInputState,
  parseTerminalCommandInput,
} from './terminalNode/commandInput'
import { createPtyWriteQueue, handleTerminalCustomKeyEvent } from './terminalNode/inputBridge'
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
import { registerTerminalSelectionTestHandle } from './terminalNode/testHarness'
import { useTerminalResize } from './terminalNode/useTerminalResize'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import { shouldStopWheelPropagation } from './terminalNode/wheel'
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
  onSaveLastMessageToNote,
  onResize,
  onScrollbackChange,
  onTitleCommit,
  onCommandRun,
  onInteractionStart,
}: TerminalNodeProps): JSX.Element {
  const dragSurfaceSelectionMode = useStore(
    state => (state as { coveDragSurfaceSelectionMode?: boolean }).coveDragSurfaceSelectionMode,
  )

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

  const { draftFrame, handleResizePointerDown } = useTerminalResize({
    position,
    width,
    height,
    onResize,
    syncTerminalSize,
    scheduleScrollbackPublish,
    isPointerResizingRef,
  })

  const renderedFrame = draftFrame ?? {
    position,
    size: { width, height },
  }
  const sizeStyle = {
    width: renderedFrame.size.width,
    height: renderedFrame.size.height,
    transform:
      renderedFrame.position.x !== position.x || renderedFrame.position.y !== position.y
        ? `translate(${renderedFrame.position.x - position.x}px, ${renderedFrame.position.y - position.y}px)`
        : undefined,
  }

  useEffect(() => {
    if (sessionId.trim().length === 0) {
      return undefined
    }

    const ptyWithOptionalAttach = window.opencoveApi.pty as typeof window.opencoveApi.pty & {
      attach?: (payload: { sessionId: string }) => Promise<void>
      detach?: (payload: { sessionId: string }) => Promise<void>
    }

    const cachedScreenState = getCachedTerminalScreenState(nodeId, sessionId)
    const scrollbackBuffer = scrollbackBufferRef.current

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#0a0f1d',
        foreground: '#d6e4ff',
      },
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
      cols: cachedScreenState?.cols,
      rows: cachedScreenState?.rows,
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

    const unsubscribeData = ptyEventHub.onSessionData(sessionId, event => {
      if (isHydrating) {
        bufferedDataChunks.push(event.data)
        return
      }

      terminal.write(event.data)
      scrollbackBuffer.append(event.data)
      markScrollbackDirty()
    })

    const unsubscribeExit = ptyEventHub.onSessionExit(sessionId, event => {
      if (isHydrating) {
        bufferedExitCode = event.exitCode
        return
      }

      const exitMessage = `\\r\\n[process exited with code ${event.exitCode}]\\r\\n`
      terminal.write(exitMessage)
      scrollbackBuffer.append(exitMessage)
      markScrollbackDirty(true)
    })

    const attachPromise = Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId }))

    const finalizeHydration = (rawSnapshot: string): void => {
      if (isDisposed) {
        return
      }

      scrollbackBuffer.set(rawSnapshot)
      isHydrating = false
      ptyWriteQueue.flush()

      const revealTerminal = () => {
        requestAnimationFrame(() => {
          syncTerminalSize()
          requestAnimationFrame(() => {
            if (!isDisposed) {
              isTerminalHydratedRef.current = true
              setIsTerminalHydrated(true)
            }
          })
        })
      }

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
      revealTerminal()
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncTerminalSize()
      }
    }

    const handleWindowFocus = () => {
      syncTerminalSize()
    }

    const handleLayoutSync = () => {
      syncTerminalSize()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener(TERMINAL_LAYOUT_SYNC_EVENT, handleLayoutSync)

    return () => {
      const isInvalidated = isCachedTerminalScreenStateInvalidated(nodeId, sessionId)

      if (!isInvalidated && isTerminalHydratedRef.current) {
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
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, handleLayoutSync)
      resizeObserver.disconnect()
      dataDisposable.dispose()
      binaryDisposable.dispose()
      unsubscribeData()
      unsubscribeExit()
      disposeTerminalSelectionTestHandle()
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
  const hasSelectedDragSurface = dragSurfaceSelectionMode === true && (isSelected || isDragging)

  return (
    <div
      className={`terminal-node nowheel ${hasSelectedDragSurface ? 'terminal-node--selected-surface' : ''}`.trim()}
      style={sizeStyle}
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
        onSaveLastMessageToNote={onSaveLastMessageToNote}
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
