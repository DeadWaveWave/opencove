import type { TerminalDiagnosticsDetailValue } from '@shared/contracts/dto'
import type { Terminal } from '@xterm/xterm'
import {
  captureTerminalDiagnosticsSnapshot,
  captureTerminalInputDataDetails,
  captureTerminalTextareaDetails,
  createTerminalDiagnosticsLogger,
} from './diagnostics'

type TerminalDiagnosticsLogger = ReturnType<typeof createTerminalDiagnosticsLogger>

export function registerTerminalTextareaDiagnostics({
  enabled,
  diagnostics,
  terminal,
  viewportElement,
  container,
  collectTranscriptDetails,
}: {
  enabled: boolean
  diagnostics: TerminalDiagnosticsLogger
  terminal: Terminal
  viewportElement: HTMLElement | null
  container: HTMLDivElement | null
  collectTranscriptDetails: () => Record<string, TerminalDiagnosticsDetailValue>
}): { dispose: () => void } {
  const textareaElement =
    terminal.textarea instanceof HTMLTextAreaElement ? terminal.textarea : null
  const textareaDocument = textareaElement?.ownerDocument ?? null
  const textareaDisposers: Array<() => void> = []

  const collectTextareaDetails = () => captureTerminalTextareaDetails({ container })

  const logTextareaEvent = (
    event: string,
    details?: Record<string, TerminalDiagnosticsDetailValue>,
  ): void => {
    diagnostics.log(event, captureTerminalDiagnosticsSnapshot(terminal, viewportElement), {
      ...(details ?? {}),
      ...collectTextareaDetails(),
      ...collectTranscriptDetails(),
    })
  }

  const getClipboardText = (event: ClipboardEvent): string | null => {
    try {
      const clipboardText = event.clipboardData?.getData('text/plain') ?? ''
      return clipboardText.length > 0 ? clipboardText : null
    } catch {
      return null
    }
  }

  const addTextareaListener = <K extends keyof HTMLElementEventMap>(
    eventName: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions | boolean,
  ): void => {
    if (!textareaElement) {
      return
    }

    textareaElement.addEventListener(eventName, listener as EventListener, options)
    textareaDisposers.push(() => {
      textareaElement.removeEventListener(eventName, listener as EventListener, options)
    })
  }

  if (enabled && textareaElement) {
    addTextareaListener(
      'keydown',
      event => {
        logTextareaEvent('textarea-keydown', {
          key: event.key,
          code: event.code || null,
          keyCode: Number.isFinite(event.keyCode) ? event.keyCode : null,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          repeat: event.repeat,
          isComposing: event.isComposing,
        })
      },
      true,
    )
    addTextareaListener(
      'keyup',
      event => {
        logTextareaEvent('textarea-keyup', {
          key: event.key,
          code: event.code || null,
          keyCode: Number.isFinite(event.keyCode) ? event.keyCode : null,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          repeat: event.repeat,
          isComposing: event.isComposing,
        })
      },
      true,
    )
    addTextareaListener(
      'beforeinput',
      event => {
        const inputEvent = event as InputEvent
        logTextareaEvent('textarea-beforeinput', {
          inputType: inputEvent.inputType || null,
          isComposing: inputEvent.isComposing,
          ...captureTerminalInputDataDetails({
            data: inputEvent.data ?? '',
          }),
        })
      },
      true,
    )
    addTextareaListener(
      'input',
      event => {
        const inputEvent = event as InputEvent
        logTextareaEvent('textarea-input', {
          inputType: inputEvent.inputType || null,
          isComposing: inputEvent.isComposing,
          ...captureTerminalInputDataDetails({
            data: inputEvent.data ?? '',
          }),
        })
      },
      true,
    )
    addTextareaListener(
      'paste',
      event => {
        logTextareaEvent('textarea-paste', {
          ...captureTerminalInputDataDetails({
            data: getClipboardText(event) ?? '',
          }),
        })
      },
      true,
    )
    addTextareaListener(
      'compositionstart',
      () => {
        logTextareaEvent('textarea-compositionstart')
      },
      true,
    )
    addTextareaListener(
      'compositionupdate',
      event => {
        logTextareaEvent('textarea-compositionupdate', {
          ...captureTerminalInputDataDetails({
            data: event.data ?? '',
          }),
        })
      },
      true,
    )
    addTextareaListener(
      'compositionend',
      event => {
        logTextareaEvent('textarea-compositionend', {
          ...captureTerminalInputDataDetails({
            data: event.data ?? '',
          }),
        })
      },
      true,
    )
    addTextareaListener(
      'select',
      () => {
        logTextareaEvent('textarea-select')
      },
      true,
    )

    if (textareaDocument) {
      const handleDocumentSelectionChange = (): void => {
        if (textareaDocument.activeElement !== textareaElement) {
          return
        }

        logTextareaEvent('textarea-selectionchange')
      }

      textareaDocument.addEventListener('selectionchange', handleDocumentSelectionChange)
      textareaDisposers.push(() => {
        textareaDocument.removeEventListener('selectionchange', handleDocumentSelectionChange)
      })
    }
  }

  return {
    dispose: () => {
      textareaDisposers.forEach(dispose => dispose())
    },
  }
}
