import type { Terminal } from '@xterm/xterm'
import type { TerminalDiagnosticsLogInput } from '@shared/contracts/dto'
import { parseTerminalCommandInput, type TerminalCommandInputState } from './commandInput'
import { createPtyWriteQueue, handleTerminalCustomKeyEvent } from './inputBridge'
import { isAutomaticTerminalReply } from './inputClassification'
import { hasRecentTerminalUserInteraction } from './userInteractionWindow'

export interface RuntimeTerminalInputBridge {
  ptyWriteQueue: ReturnType<typeof createPtyWriteQueue>
  releaseBufferedUserInput: () => void
  enableTerminalDataForwarding: () => void
  dispose: () => void
}

function formatInputHeadHex(value: string, limit = 12): string {
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

export function createRuntimeTerminalInputBridge({
  terminal,
  sessionId,
  openTerminalFind,
  onCommandRunRef,
  commandInputStateRef,
  suppressPtyResizeRef,
  syncTerminalSize,
  shouldGateInitialUserInput,
  pendingUserInputBufferRef,
  recentUserInteractionAtRef,
  inputDiagnosticsEnabled,
  terminalDiagnostics,
}: {
  terminal: Terminal
  sessionId: string
  openTerminalFind: () => void
  onCommandRunRef: { current: ((command: string) => void) | undefined }
  commandInputStateRef: { current: TerminalCommandInputState }
  suppressPtyResizeRef: { current: boolean }
  syncTerminalSize: () => void
  shouldGateInitialUserInput: boolean
  pendingUserInputBufferRef: {
    current: Array<{ data: string; encoding: 'utf8' | 'binary' }>
  }
  recentUserInteractionAtRef: { current: number }
  inputDiagnosticsEnabled: boolean
  terminalDiagnostics: {
    log: (event: string, details?: TerminalDiagnosticsLogInput['details']) => void
  }
}): RuntimeTerminalInputBridge {
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

  let isBufferedUserInputGateOpen = !shouldGateInitialUserInput
  let shouldForwardTerminalData = false

  const bufferUserInput = (data: string, encoding: 'utf8' | 'binary'): void => {
    if (data.length === 0) {
      return
    }

    if (
      data.startsWith('\u001b') &&
      !hasRecentTerminalUserInteraction(recentUserInteractionAtRef)
    ) {
      return
    }

    pendingUserInputBufferRef.current.push({ data, encoding })
  }

  const flushBufferedUserInput = (): void => {
    if (pendingUserInputBufferRef.current.length === 0) {
      return
    }

    const bufferedInput = [...pendingUserInputBufferRef.current]
    pendingUserInputBufferRef.current.length = 0
    bufferedInput.forEach(entry => {
      ptyWriteQueue.enqueue(entry.data, entry.encoding)
    })
    ptyWriteQueue.flush()
  }

  const forwardAutomaticTerminalReply = (data: string, encoding: 'utf8' | 'binary'): boolean => {
    if (!data.startsWith('\u001b') || !isAutomaticTerminalReply(data)) {
      return false
    }

    ptyWriteQueue.enqueue(data, encoding)
    ptyWriteQueue.flush()
    return true
  }

  terminal.attachCustomKeyEventHandler(event =>
    handleTerminalCustomKeyEvent({
      event,
      ptyWriteQueue,
      terminal,
      onOpenFind: openTerminalFind,
    }),
  )

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
        inputGateOpen: isBufferedUserInputGateOpen,
      })
    }

    if (!isBufferedUserInputGateOpen) {
      if (forwardAutomaticTerminalReply(data, 'utf8')) {
        return
      }

      if (
        data.startsWith('\u001b') &&
        !hasRecentTerminalUserInteraction(recentUserInteractionAtRef)
      ) {
        if (inputDiagnosticsEnabled) {
          terminalDiagnostics.log('xterm-onData-dropped', {
            reason: 'esc-before-input-gate-open',
            dataLength: data.length,
            dataHeadHex: formatInputHeadHex(data),
          })
        }
        return
      }

      bufferUserInput(data, 'utf8')
      return
    }

    if (!shouldForwardTerminalData) {
      if (forwardAutomaticTerminalReply(data, 'utf8')) {
        return
      }

      if (data.startsWith('\u001b')) {
        if (
          shouldGateInitialUserInput ||
          hasRecentTerminalUserInteraction(recentUserInteractionAtRef)
        ) {
          bufferUserInput(data, 'utf8')
          return
        }

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
        inputGateOpen: isBufferedUserInputGateOpen,
      })
    }

    if (!isBufferedUserInputGateOpen) {
      if (forwardAutomaticTerminalReply(data, 'binary')) {
        return
      }

      if (
        data.startsWith('\u001b') &&
        !hasRecentTerminalUserInteraction(recentUserInteractionAtRef)
      ) {
        if (inputDiagnosticsEnabled) {
          terminalDiagnostics.log('xterm-onBinary-dropped', {
            reason: 'esc-before-input-gate-open',
            dataLength: data.length,
            dataHeadHex: formatInputHeadHex(data),
          })
        }
        return
      }

      bufferUserInput(data, 'binary')
      return
    }

    if (!shouldForwardTerminalData) {
      if (forwardAutomaticTerminalReply(data, 'binary')) {
        return
      }

      if (data.startsWith('\u001b')) {
        if (
          shouldGateInitialUserInput ||
          hasRecentTerminalUserInteraction(recentUserInteractionAtRef)
        ) {
          bufferUserInput(data, 'binary')
          return
        }

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

  return {
    ptyWriteQueue,
    releaseBufferedUserInput: () => {
      isBufferedUserInputGateOpen = true
      flushBufferedUserInput()
    },
    enableTerminalDataForwarding: () => {
      shouldForwardTerminalData = true
    },
    dispose: () => {
      dataDisposable.dispose()
      binaryDisposable.dispose()
      ptyWriteQueue.dispose()
    },
  }
}
