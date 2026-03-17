import { describe, expect, it, vi } from 'vitest'
import {
  createPtyWriteQueue,
  handleTerminalCustomKeyEvent,
  pasteTextFromClipboard,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputBridge'

describe('handleTerminalCustomKeyEvent', () => {
  it('copies the selected terminal text on Windows Ctrl+C', async () => {
    const copySelectedText = vi.fn(async () => undefined)
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }

    const result = handleTerminalCustomKeyEvent({
      copySelectedText,
      event: new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue,
      terminal: {
        hasSelection: () => true,
        getSelection: () => 'selected output',
        paste: vi.fn(),
      },
    })

    expect(result).toBe(false)
    expect(copySelectedText).toHaveBeenCalledWith('selected output')
    expect(ptyWriteQueue.enqueue).not.toHaveBeenCalled()
  })

  it('keeps Windows Ctrl+C as terminal interrupt when there is no selection', () => {
    const copySelectedText = vi.fn(async () => undefined)

    const result = handleTerminalCustomKeyEvent({
      copySelectedText,
      event: new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal: {
        hasSelection: () => false,
        getSelection: () => '',
        paste: vi.fn(),
      },
    })

    expect(result).toBe(true)
    expect(copySelectedText).not.toHaveBeenCalled()
  })

  it('does not change non-Windows Ctrl+C behavior', () => {
    const copySelectedText = vi.fn(async () => undefined)

    const result = handleTerminalCustomKeyEvent({
      copySelectedText,
      event: new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
      platformInfo: { platform: 'Linux x86_64' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal: {
        hasSelection: () => true,
        getSelection: () => 'selected output',
        paste: vi.fn(),
      },
    })

    expect(result).toBe(true)
    expect(copySelectedText).not.toHaveBeenCalled()
  })

  it('pastes clipboard text on Windows Ctrl+V', () => {
    const pasteClipboardText = vi.fn()
    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    const terminal = {
      hasSelection: () => false,
      getSelection: () => '',
      paste: vi.fn(),
    }

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal,
    })

    expect(result).toBe(false)
    expect(pasteClipboardText).toHaveBeenCalledWith({ terminal })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('pastes clipboard text on Windows Shift+Insert', () => {
    const pasteClipboardText = vi.fn()
    const event = {
      type: 'keydown',
      key: 'Insert',
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    const terminal = {
      hasSelection: () => false,
      getSelection: () => '',
      paste: vi.fn(),
    }

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal,
    })

    expect(result).toBe(false)
    expect(pasteClipboardText).toHaveBeenCalledWith({ terminal })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('preserves Shift+Enter terminal input bridging', () => {
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }

    const result = handleTerminalCustomKeyEvent({
      event: new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
      ptyWriteQueue,
      terminal: {
        hasSelection: () => false,
        getSelection: () => '',
        paste: vi.fn(),
      },
    })

    expect(result).toBe(false)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b\r')
    expect(ptyWriteQueue.flush).toHaveBeenCalledTimes(1)
  })

  it('writes clipboard text through xterm paste', async () => {
    const readClipboardText = vi.fn(async () => 'clipboard payload')
    const terminal = {
      paste: vi.fn(),
    }

    await pasteTextFromClipboard({
      readClipboardText,
      terminal,
    })

    expect(readClipboardText).toHaveBeenCalledTimes(1)
    expect(terminal.paste).toHaveBeenCalledWith('clipboard payload')
  })

  it('preserves binary writes as a separate PTY payload', async () => {
    const writes: Array<{ data: string; encoding: 'utf8' | 'binary' }> = []
    const ptyWriteQueue = createPtyWriteQueue(async payload => {
      writes.push(payload)
    })

    ptyWriteQueue.enqueue('plain-text')
    ptyWriteQueue.enqueue(String.fromCharCode(64, 80), 'binary')
    ptyWriteQueue.flush()

    await Promise.resolve()
    await Promise.resolve()

    expect(writes).toEqual([
      { data: 'plain-text', encoding: 'utf8' },
      { data: String.fromCharCode(64, 80), encoding: 'binary' },
    ])
  })
})
