import type { Terminal } from '@xterm/xterm'
import { handleTerminalCustomKeyEvent } from './inputBridge'
import type { WindowsAutomationPasteGuard } from './windowsAutomationPasteGuard'

type PtyWriteQueue = {
  enqueue: (data: string, encoding?: 'utf8' | 'binary') => void
  flush: () => void
}

export function bindTerminalCustomKeyHandler({
  automationPasteGuard,
  terminal,
  ptyWriteQueue,
  onOpenFind,
}: {
  automationPasteGuard?: WindowsAutomationPasteGuard | null
  terminal: Terminal
  ptyWriteQueue: PtyWriteQueue
  onOpenFind?: () => void
}): void {
  terminal.attachCustomKeyEventHandler(event =>
    handleTerminalCustomKeyEvent({
      automationPasteGuard,
      event,
      ptyWriteQueue,
      terminal,
      onOpenFind,
    }),
  )
}
