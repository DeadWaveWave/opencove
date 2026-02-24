import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { resolveStablePtySize } from '../utils/terminalResize'
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  TERMINAL_LAYOUT_SYNC_EVENT,
  type ResizeAxis,
} from './terminalNode/constants'
import {
  createTerminalCommandInputState,
  parseTerminalCommandInput,
} from './terminalNode/commandInput'
import { createPtyWriteQueue, registerXtermPasteGuards } from './terminalNode/inputBridge'
import { mergeScrollbackSnapshots } from './terminalNode/scrollback'
import { TerminalNodeHeader } from './terminalNode/TerminalNodeHeader'
import { resolveSuffixPrefixOverlap } from './terminalNode/overlap'
import { useTerminalScrollback } from './terminalNode/useScrollback'
import { shouldStopWheelPropagation } from './terminalNode/wheel'
import type { TerminalNodeProps } from './TerminalNode.types'

export function TerminalNode({
  sessionId,
  title,
  kind,
  status,
  lastError,
  width,
  height,
  scrollback,
  onClose,
  onResize,
  onScrollbackChange,
  onTitleCommit,
  onCommandRun,
  onInteractionStart,
  onStop,
  onRerun,
  onResume,
}: TerminalNodeProps): JSX.Element {
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const resizeStartRef = useRef<{
    x: number
    y: number
    width: number
    height: number
    axis: ResizeAxis
  } | null>(null)
  const isPointerResizingRef = useRef(false)
  const lastSyncedPtySizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const commandInputStateRef = useRef(createTerminalCommandInputState())
  const onCommandRunRef = useRef(onCommandRun)

  useEffect(() => {
    onCommandRunRef.current = onCommandRun
  }, [onCommandRun])

  const {
    scrollbackBufferRef,
    markScrollbackDirty,
    scheduleScrollbackPublish,
    disposeScrollbackPublish,
  } = useTerminalScrollback({
    sessionId,
    scrollback,
    onScrollbackChange,
    isPointerResizingRef,
  })

  const draftSizeRef = useRef<{ width: number; height: number } | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [draftSize, setDraftSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    draftSizeRef.current = draftSize
  }, [draftSize])

  useEffect(() => {
    if (!draftSize || isResizing) {
      return
    }

    if (draftSize.width === width && draftSize.height === height) {
      setDraftSize(null)
    }
  }, [draftSize, height, isResizing, width])

  useEffect(() => {
    lastSyncedPtySizeRef.current = null
    commandInputStateRef.current = createTerminalCommandInputState()
  }, [sessionId])

  const renderedSize = draftSize ?? { width, height }
  const sizeStyle = useMemo(
    () => ({ width: renderedSize.width, height: renderedSize.height }),
    [renderedSize.height, renderedSize.width],
  )

  const syncTerminalSize = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const container = containerRef.current

    if (!terminal || !fitAddon || !container) {
      return
    }

    if (container.clientWidth <= 2 || container.clientHeight <= 2) {
      return
    }

    if (isPointerResizingRef.current) {
      return
    }

    fitAddon.fit()

    if (terminal.cols <= 0 || terminal.rows <= 0) {
      return
    }

    terminal.refresh(0, Math.max(0, terminal.rows - 1))

    const nextPtySize = resolveStablePtySize({
      previous: lastSyncedPtySizeRef.current,
      measured: { cols: terminal.cols, rows: terminal.rows },
      preventRowShrink: false,
    })

    if (!nextPtySize) {
      return
    }

    lastSyncedPtySizeRef.current = nextPtySize

    void window.coveApi.pty.resize({
      sessionId,
      cols: nextPtySize.cols,
      rows: nextPtySize.rows,
    })
  }, [sessionId])

  useEffect(() => {
    const ptyWithOptionalAttach = window.coveApi.pty as typeof window.coveApi.pty & {
      attach?: (payload: { sessionId: string }) => Promise<void>
      detach?: (payload: { sessionId: string }) => Promise<void>
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      theme: {
        background: '#0a0f1d',
        foreground: '#d6e4ff',
      },
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    let disposeXtermPasteGuards = () => undefined
    const ptyWriteQueue = createPtyWriteQueue(data => window.coveApi.pty.write({ sessionId, data }))

    if (containerRef.current) {
      terminal.open(containerRef.current)
      disposeXtermPasteGuards = registerXtermPasteGuards(containerRef.current)
      requestAnimationFrame(syncTerminalSize)
      if (window.coveApi.meta.isTest) {
        terminal.focus()
      }
    }

    let isDisposed = false
    let shouldForwardTerminalData = false

    const disposable = terminal.onData(data => {
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

    let isHydrating = true
    const bufferedDataChunks: string[] = []
    let bufferedExitCode: number | null = null

    const unsubscribeData = window.coveApi.pty.onData(event => {
      if (event.sessionId !== sessionId) {
        return
      }

      if (isHydrating) {
        bufferedDataChunks.push(event.data)
        return
      }

      terminal.write(event.data)
      scrollbackBufferRef.current.append(event.data)
      markScrollbackDirty()
    })

    const unsubscribeExit = window.coveApi.pty.onExit(event => {
      if (event.sessionId !== sessionId) {
        return
      }

      if (isHydrating) {
        bufferedExitCode = event.exitCode
        return
      }

      const exitMessage = `\\r\\n[process exited with code ${event.exitCode}]\\r\\n`
      terminal.write(exitMessage)
      scrollbackBufferRef.current.append(exitMessage)
      markScrollbackDirty(true)
    })

    const attachPromise = Promise.resolve(ptyWithOptionalAttach.attach?.({ sessionId }))

    const finalizeHydration = (snapshot: string): void => {
      if (isDisposed) {
        return
      }

      scrollbackBufferRef.current.set(snapshot)
      isHydrating = false
      ptyWriteQueue.flush()

      const bufferedData = bufferedDataChunks.join('')
      bufferedDataChunks.length = 0

      if (bufferedData.length > 0) {
        const overlap = resolveSuffixPrefixOverlap(snapshot, bufferedData)
        const remainder = bufferedData.slice(overlap)

        if (remainder.length > 0) {
          terminal.write(remainder)
          scrollbackBufferRef.current.append(remainder)
        }
      }

      if (bufferedExitCode !== null) {
        const exitMessage = `\\r\\n[process exited with code ${bufferedExitCode}]\\r\\n`
        bufferedExitCode = null
        terminal.write(exitMessage)
        scrollbackBufferRef.current.append(exitMessage)
      }

      markScrollbackDirty(true)
      syncTerminalSize()
    }

    const hydrateFromSnapshot = async () => {
      await attachPromise.catch(() => undefined)

      const persistedSnapshot = scrollbackBufferRef.current.snapshot()
      let mergedSnapshot = persistedSnapshot

      try {
        const snapshot = await window.coveApi.pty.snapshot({ sessionId })
        mergedSnapshot = mergeScrollbackSnapshots(persistedSnapshot, snapshot.data)
      } catch {
        // ignore snapshot read failures and continue with available persisted history
      }

      if (isDisposed) {
        return
      }

      if (mergedSnapshot.length > 0) {
        terminal.write(mergedSnapshot, () => {
          shouldForwardTerminalData = true
          finalizeHydration(mergedSnapshot)
        })
      } else {
        shouldForwardTerminalData = true
        finalizeHydration(mergedSnapshot)
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
      isDisposed = true
      const detachPromise = ptyWithOptionalAttach.detach?.({ sessionId })
      void detachPromise?.catch(() => undefined)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener(TERMINAL_LAYOUT_SYNC_EVENT, handleLayoutSync)
      resizeObserver.disconnect()
      disposable.dispose()
      unsubscribeData()
      unsubscribeExit()
      disposeXtermPasteGuards()
      ptyWriteQueue.dispose()
      disposeScrollbackPublish()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [
    disposeScrollbackPublish,
    markScrollbackDirty,
    scrollbackBufferRef,
    sessionId,
    syncTerminalSize,
  ])

  useEffect(() => {
    const frame = requestAnimationFrame(syncTerminalSize)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [height, syncTerminalSize, width])

  const handleResizePointerDown = useCallback(
    (axis: ResizeAxis) => (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)

      resizeStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        width,
        height,
        axis,
      }

      isPointerResizingRef.current = true
      setDraftSize({ width, height })
      setIsResizing(true)
    },
    [height, width],
  )

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) {
        return
      }

      if (start.axis === 'horizontal') {
        const nextWidth = Math.max(MIN_WIDTH, Math.round(start.width + (event.clientX - start.x)))
        setDraftSize({ width: nextWidth, height: start.height })
        return
      }

      const nextHeight = Math.max(MIN_HEIGHT, Math.round(start.height + (event.clientY - start.y)))
      setDraftSize({ width: start.width, height: nextHeight })
    }

    const handlePointerUp = () => {
      setIsResizing(false)
      isPointerResizingRef.current = false

      const finalSize = draftSizeRef.current ?? { width, height }
      onResize(finalSize)

      resizeStartRef.current = null
      requestAnimationFrame(() => {
        syncTerminalSize()
        scheduleScrollbackPublish(true)
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [height, isResizing, onResize, scheduleScrollbackPublish, syncTerminalSize, width])

  const isAgentNode = kind === 'agent'

  return (
    <div
      className="terminal-node nowheel"
      style={sizeStyle}
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
        onTitleCommit={onTitleCommit}
        onClose={onClose}
        onStop={onStop}
        onRerun={onRerun}
        onResume={onResume}
      />

      {isAgentNode && lastError ? <div className="terminal-node__error">{lastError}</div> : null}

      <div
        ref={containerRef}
        className="terminal-node__terminal nodrag"
        onPointerDown={event => {
          if (event.button !== 0) {
            return
          }

          onInteractionStart?.()
        }}
      />
      <button
        type="button"
        className="terminal-node__resizer terminal-node__resizer--right nodrag"
        onPointerDown={handleResizePointerDown('horizontal')}
        aria-label="Resize terminal width"
        data-testid="terminal-resizer-right"
      />
      <button
        type="button"
        className="terminal-node__resizer terminal-node__resizer--bottom nodrag"
        onPointerDown={handleResizePointerDown('vertical')}
        aria-label="Resize terminal height"
        data-testid="terminal-resizer-bottom"
      />
    </div>
  )
}
