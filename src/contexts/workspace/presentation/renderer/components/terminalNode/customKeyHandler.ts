import type { Terminal } from '@xterm/xterm'
import { handleTerminalCustomKeyEvent } from './inputBridge'

type PtyWriteQueue = {
  enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
  flush: () => void
}

export function bindTerminalCustomKeyHandler({
  terminal,
  ptyWriteQueue,
  onOpenFind,
}: {
  terminal: Terminal
  ptyWriteQueue: PtyWriteQueue
  onOpenFind?: () => void
}): void {
  terminal.attachCustomKeyEventHandler(event =>
    handleTerminalCustomKeyEvent({ event, ptyWriteQueue, terminal, onOpenFind }),
  )
}
