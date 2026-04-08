import type { MutableRefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { createTerminalCommandInputState, parseTerminalCommandInput } from './commandInput'

export function registerTerminalPtyInputListeners({
  commandInputStateRef,
  onCommandRunRef,
  ptyWriteQueue,
  shouldForwardTerminalData,
  suppressPtyResizeRef,
  syncTerminalSize,
  terminal,
}: {
  commandInputStateRef: MutableRefObject<ReturnType<typeof createTerminalCommandInputState>>
  onCommandRunRef: MutableRefObject<((command: string) => void) | undefined>
  ptyWriteQueue: {
    enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
    flush: () => void
  }
  shouldForwardTerminalData: () => boolean
  suppressPtyResizeRef: MutableRefObject<boolean>
  syncTerminalSize: () => void
  terminal: Terminal
}): {
  binaryDisposable: { dispose: () => void }
  dataDisposable: { dispose: () => void }
} {
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

  return {
    binaryDisposable,
    dataDisposable,
  }
}
