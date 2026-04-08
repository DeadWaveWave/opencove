import type { Terminal } from '@xterm/xterm'
import {
  createPtyWriteQueue,
  handleTerminalCustomKeyEvent,
  type TerminalShortcutDecision,
} from './inputBridge'
import {
  createWindowsAutomationPasteGuard,
  type WindowsAutomationPasteGuard,
} from './windowsAutomationPasteGuard'

type PtyWriteEncoding = 'utf8' | 'binary'

export function createTrackedPtyWriteQueue({
  sessionId,
  onPtyWrite,
}: {
  sessionId: string
  onPtyWrite?: (payload: { data: string; encoding: PtyWriteEncoding }) => void
}) {
  return createPtyWriteQueue(({ data, encoding }) =>
    Promise.resolve()
      .then(() => {
        onPtyWrite?.({ data, encoding })
      })
      .then(async () => {
        await window.opencoveApi.pty.write({
          sessionId,
          data,
          ...(encoding === 'binary' ? { encoding } : {}),
        })
      }),
  )
}

export function registerTerminalInputRuntime({
  onOpenFind,
  onShortcutDecision,
  ptyWriteQueue,
  terminal,
  windowsAutomationPasteGuardEnabled,
}: {
  onOpenFind: () => void
  onShortcutDecision?: (decision: TerminalShortcutDecision) => void
  ptyWriteQueue: ReturnType<typeof createPtyWriteQueue>
  terminal: Terminal
  windowsAutomationPasteGuardEnabled: boolean
}): {
  selectionChangeDisposable: { dispose: () => void }
  windowsAutomationPasteGuard: WindowsAutomationPasteGuard | null
} {
  const windowsAutomationPasteGuard = windowsAutomationPasteGuardEnabled
    ? createWindowsAutomationPasteGuard({ ptyWriteQueue })
    : null

  const selectionChangeDisposable =
    windowsAutomationPasteGuard &&
    typeof (terminal as unknown as { onSelectionChange?: unknown }).onSelectionChange === 'function'
      ? (
          terminal as unknown as {
            onSelectionChange: (listener: () => void) => { dispose: () => void }
          }
        ).onSelectionChange(() => {
          windowsAutomationPasteGuard.noteSelectionChange(terminal.hasSelection(), () =>
            terminal.clearSelection(),
          )
        })
      : { dispose: () => undefined }

  terminal.attachCustomKeyEventHandler(event =>
    handleTerminalCustomKeyEvent({
      automationPasteGuard: windowsAutomationPasteGuard,
      event,
      logShortcutDecision: onShortcutDecision,
      onOpenFind,
      ptyWriteQueue,
      terminal,
    }),
  )

  return {
    selectionChangeDisposable,
    windowsAutomationPasteGuard,
  }
}
