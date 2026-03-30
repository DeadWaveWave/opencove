import { describe, expect, it, vi } from 'vitest'
import {
  createPtyWriteQueue,
  handleTerminalCustomKeyEvent,
  isMacTerminalPasteShortcut,
  pasteTextFromClipboard,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputBridge'

describe('isMacTerminalPasteShortcut', () => {
  it('returns true for Cmd+V on macOS', () => {
    expect(
      isMacTerminalPasteShortcut(
        { key: 'v', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        { platform: 'MacIntel' },
      ),
    ).toBe(true)
  })

  it('returns false for Cmd+V on Windows', () => {
    expect(
      isMacTerminalPasteShortcut(
        { key: 'v', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        { platform: 'Win32' },
      ),
    ).toBe(false)
  })

  it('returns false for Ctrl+V on macOS', () => {
    expect(
      isMacTerminalPasteShortcut(
        { key: 'v', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        { platform: 'MacIntel' },
      ),
    ).toBe(false)
  })

  it('returns false for Cmd+Shift+V', () => {
    expect(
      isMacTerminalPasteShortcut(
        { key: 'v', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        { platform: 'MacIntel' },
      ),
    ).toBe(false)
  })
})

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

  it('pastes clipboard text on macOS Cmd+V', () => {
    const pasteClipboardText = vi.fn()
    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: true,
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
      platformInfo: { platform: 'MacIntel' },
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

  it('does not intercept macOS Cmd+C (lets xterm.js handle copy)', () => {
    const pasteClipboardText = vi.fn()
    const copySelectedText = vi.fn(async () => undefined)

    const result = handleTerminalCustomKeyEvent({
      copySelectedText,
      event: new KeyboardEvent('keydown', { key: 'c', metaKey: true }),
      pasteClipboardText,
      platformInfo: { platform: 'MacIntel' },
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
    expect(pasteClipboardText).not.toHaveBeenCalled()
    expect(copySelectedText).not.toHaveBeenCalled()
  })

  it('does not intercept macOS Cmd+Shift+V', () => {
    const pasteClipboardText = vi.fn()
    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      metaKey: true,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'MacIntel' },
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
    expect(pasteClipboardText).not.toHaveBeenCalled()
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
