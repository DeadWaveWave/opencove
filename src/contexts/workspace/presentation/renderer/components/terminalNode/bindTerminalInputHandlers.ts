import type { Terminal } from '@xterm/xterm'
import type { MutableRefObject } from 'react'
import { parseTerminalCommandInput, type TerminalCommandInputState } from './commandInput'

type Disposable = { dispose: () => void }

export function bindTerminalInputHandlers(input: {
  terminal: Terminal
  shouldForwardTerminalData: () => boolean
  suppressPtyResizeRef: MutableRefObject<boolean>
  syncTerminalSize: () => void
  ptyWriteQueue: {
    enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
    flush: () => void
  }
  onCommandRunRef: MutableRefObject<((command: string) => void) | undefined>
  commandInputStateRef: MutableRefObject<TerminalCommandInputState>
}): { dataDisposable: Disposable; binaryDisposable: Disposable } {
  const {
    terminal,
    shouldForwardTerminalData,
    suppressPtyResizeRef,
    syncTerminalSize,
    ptyWriteQueue,
    onCommandRunRef,
    commandInputStateRef,
  } = input

  const dataDisposable = terminal.onData(data => {
    if (!shouldForwardTerminalData()) {
      return
    }
    if (suppressPtyResizeRef.current) {
      suppressPtyResizeRef.current = false
      syncTerminalSize()
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
    if (!shouldForwardTerminalData()) {
      return
    }
    if (suppressPtyResizeRef.current) {
      suppressPtyResizeRef.current = false
      syncTerminalSize()
    }
    ptyWriteQueue.enqueue(data, 'binary')
    ptyWriteQueue.flush()
  })

  return { dataDisposable, binaryDisposable }
}
