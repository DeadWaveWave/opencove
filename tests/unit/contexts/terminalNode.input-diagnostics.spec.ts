import { describe, expect, it, vi } from 'vitest'
import { registerTerminalDiagnostics } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/registerDiagnostics'
import {
  captureTerminalTextareaDetails,
  captureTerminalTranscriptDetails,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/diagnostics'

describe('terminal textarea and transcript diagnostics', () => {
  it('captures a tail of the transcript mirror text', () => {
    const terminalNode = document.createElement('div')
    terminalNode.className = 'terminal-node'

    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'

    const transcript = document.createElement('div')
    transcript.className = 'terminal-node__transcript'
    transcript.textContent = 'first line\nsecond line\nsample tail'

    terminalNode.append(terminalBody, transcript)
    document.body.append(terminalNode)

    try {
      expect(
        captureTerminalTranscriptDetails({
          container: terminalBody,
          maxChars: 12,
        }),
      ).toMatchObject({
        transcriptAvailable: true,
        transcriptLineCount: 3,
        transcriptTail: '\nsample tail',
        transcriptTailTruncated: true,
      })
    } finally {
      terminalNode.remove()
    }
  })

  it('captures helper textarea details', () => {
    const terminalNode = document.createElement('div')
    terminalNode.className = 'terminal-node'

    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'

    const xterm = document.createElement('div')
    xterm.className = 'xterm'

    const screen = document.createElement('div')
    screen.className = 'xterm-screen'

    const helpers = document.createElement('div')
    helpers.className = 'xterm-helpers'

    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    textarea.value = 'sample-text-123'
    textarea.focus()
    textarea.setSelectionRange(0, 4, 'forward')

    helpers.append(textarea)
    screen.append(helpers)
    xterm.append(screen)
    terminalBody.append(xterm)
    terminalNode.append(terminalBody)
    document.body.append(terminalNode)

    try {
      expect(
        captureTerminalTextareaDetails({
          container: terminalBody,
          maxChars: 6,
        }),
      ).toMatchObject({
        textareaAvailable: true,
        textareaFocused: false,
        textareaValueLength: 15,
        textareaValueTail: 'xt-123',
        textareaValueTailTruncated: true,
        textareaSelectionStart: 0,
        textareaSelectionEnd: 4,
        textareaSelectionDirection: 'forward',
      })
    } finally {
      terminalNode.remove()
    }
  })

  it('includes transcript mirror details in diagnostics payloads', () => {
    const terminalNode = document.createElement('div')
    terminalNode.className = 'terminal-node'

    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'

    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'

    const xterm = document.createElement('div')
    xterm.className = 'xterm'

    const transcript = document.createElement('div')
    transcript.className = 'terminal-node__transcript'
    transcript.textContent = 'prefix\nsample tail'

    xterm.append(viewport)
    terminalBody.append(xterm)
    terminalNode.append(terminalBody, transcript)
    document.body.append(terminalNode)

    const emit = vi.fn()

    try {
      const registration = registerTerminalDiagnostics({
        enabled: true,
        emit,
        nodeId: 'node-2',
        sessionId: 'session-2',
        nodeKind: 'terminal',
        title: 'terminal',
        terminal: {
          cols: 80,
          rows: 24,
          buffer: {
            active: { baseY: 1, viewportY: 0, length: 10 },
          },
        } as never,
        container: terminalBody,
        rendererKind: 'dom',
        terminalThemeMode: 'sync-with-ui',
        windowsPty: null,
      })

      registration.logKeyboardShortcut({
        action: 'paste',
      })

      expect(emit.mock.calls[0]?.[0]).toMatchObject({
        event: 'init',
        details: expect.objectContaining({
          transcriptAvailable: true,
          transcriptTail: 'prefix\nsample tail',
          transcriptTailTruncated: false,
        }),
      })

      expect(emit.mock.calls[1]?.[0]).toMatchObject({
        event: 'keyboard-shortcut',
        details: expect.objectContaining({
          action: 'paste',
          transcriptTail: 'prefix\nsample tail',
        }),
      })

      registration.dispose()
    } finally {
      terminalNode.remove()
    }
  })

  it('logs helper textarea input diagnostics and PTY write summaries', () => {
    const terminalNode = document.createElement('div')
    terminalNode.className = 'terminal-node'

    const terminalBody = document.createElement('div')
    terminalBody.className = 'terminal-node__terminal'

    const viewport = document.createElement('div')
    viewport.className = 'xterm-viewport'

    const xterm = document.createElement('div')
    xterm.className = 'xterm'

    const screen = document.createElement('div')
    screen.className = 'xterm-screen'

    const helpers = document.createElement('div')
    helpers.className = 'xterm-helpers'

    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    textarea.value = '喂喂'
    helpers.append(textarea)

    screen.append(helpers)
    xterm.append(viewport, screen)
    terminalBody.append(xterm)
    terminalNode.append(terminalBody)
    document.body.append(terminalNode)

    const emit = vi.fn()

    try {
      const registration = registerTerminalDiagnostics({
        enabled: true,
        emit,
        nodeId: 'node-3',
        sessionId: 'session-3',
        nodeKind: 'terminal',
        title: 'terminal',
        terminal: {
          cols: 80,
          rows: 24,
          textarea,
          buffer: {
            active: { baseY: 1, viewportY: 0, length: 10 },
          },
        } as never,
        container: terminalBody,
        rendererKind: 'dom',
        terminalThemeMode: 'sync-with-ui',
        windowsPty: null,
      })

      textarea.setSelectionRange(0, 2)
      textarea.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          data: 'sample',
          inputType: 'insertText',
        }),
      )

      registration.logPtyWrite({
        data: '\u0003',
        encoding: 'utf8',
      })

      const beforeInputPayload = emit.mock.calls.find(
        call => call[0]?.event === 'textarea-beforeinput',
      )?.[0]
      const ptyWritePayload = emit.mock.calls.find(call => call[0]?.event === 'pty-write')?.[0]

      expect(beforeInputPayload).toMatchObject({
        event: 'textarea-beforeinput',
        details: expect.objectContaining({
          inputType: 'insertText',
          inputDataLength: 6,
          inputDataPreview: 'sample',
          textareaSelectionStart: 0,
          textareaSelectionEnd: 2,
        }),
      })

      expect(ptyWritePayload).toMatchObject({
        event: 'pty-write',
        details: expect.objectContaining({
          inputEncoding: 'utf8',
          inputDataLength: 1,
          inputDataContainsControl: true,
        }),
      })

      registration.dispose()
    } finally {
      terminalNode.remove()
    }
  })
})
