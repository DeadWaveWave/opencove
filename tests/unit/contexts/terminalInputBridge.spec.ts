import { describe, expect, it, vi } from 'vitest'
import {
  handleTerminalCustomKeyEvent,
  isLinuxTerminalCopyShortcut,
  isLinuxTerminalPasteShortcut,
  isMacTerminalPasteShortcut,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputBridge'

describe('isLinuxTerminalCopyShortcut', () => {
  it('returns true for Ctrl+Shift+C on Linux', () => {
    expect(
      isLinuxTerminalCopyShortcut(
        { key: 'c', metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        { platform: 'Linux x86_64' },
      ),
    ).toBe(true)
  })

  it('returns false for Ctrl+C on Linux', () => {
    expect(
      isLinuxTerminalCopyShortcut(
        { key: 'c', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        { platform: 'Linux x86_64' },
      ),
    ).toBe(false)
  })
})

describe('isLinuxTerminalPasteShortcut', () => {
  it('returns true for Ctrl+Shift+V on Linux', () => {
    expect(
      isLinuxTerminalPasteShortcut(
        { key: 'v', metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        { platform: 'Linux x86_64' },
      ),
    ).toBe(true)
  })

  it('returns false for Ctrl+V on Linux', () => {
    expect(
      isLinuxTerminalPasteShortcut(
        { key: 'v', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        { platform: 'Linux x86_64' },
      ),
    ).toBe(false)
  })
})

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
    const event = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }

    const result = handleTerminalCustomKeyEvent({
      copySelectedText,
      event,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue,
      terminal: {
        hasSelection: () => true,
        getSelection: () => 'selected output',
      },
    })

    expect(result).toBe(false)
    expect(copySelectedText).toHaveBeenCalledWith('selected output')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
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
      },
    })

    expect(result).toBe(true)
    expect(copySelectedText).not.toHaveBeenCalled()
  })

  it('copies the selected terminal text on Linux Ctrl+Shift+C', async () => {
    const copySelectedText = vi.fn(async () => undefined)
    const event = {
      type: 'keydown',
      key: 'C',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent

    const result = handleTerminalCustomKeyEvent({
      copySelectedText,
      event,
      platformInfo: { platform: 'Linux x86_64' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal: {
        hasSelection: () => true,
        getSelection: () => 'selected output',
      },
    })

    expect(result).toBe(false)
    expect(copySelectedText).toHaveBeenCalledWith('selected output')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('keeps Linux Ctrl+C as terminal interrupt even when there is a selection', () => {
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
      },
    })

    expect(result).toBe(true)
    expect(copySelectedText).not.toHaveBeenCalled()
  })

  it('pastes clipboard text on Windows Ctrl+V', () => {
    const pasteClipboardText = vi.fn()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
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
    }

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue,
      terminal,
    })

    expect(result).toBe(false)
    expect(pasteClipboardText).toHaveBeenCalledWith({
      isBracketedPasteMode: undefined,
      writePastePayload: expect.any(Function),
    })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('pastes clipboard text on Linux Ctrl+Shift+V', () => {
    const pasteClipboardText = vi.fn()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
    const event = {
      type: 'keydown',
      key: 'V',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent
    const terminal = {
      hasSelection: () => false,
      getSelection: () => '',
    }

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'Linux x86_64' },
      ptyWriteQueue,
      terminal,
    })

    expect(result).toBe(false)
    expect(pasteClipboardText).toHaveBeenCalledWith({
      isBracketedPasteMode: undefined,
      writePastePayload: expect.any(Function),
    })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('pastes clipboard text on Windows Shift+Insert', () => {
    const pasteClipboardText = vi.fn()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
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
    }

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue,
      terminal,
    })

    expect(result).toBe(false)
    expect(pasteClipboardText).toHaveBeenCalledWith({
      isBracketedPasteMode: undefined,
      writePastePayload: expect.any(Function),
    })
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('falls back to the PTY queue when no paste payload writer is provided', async () => {
    const pasteClipboardText = vi.fn(
      async ({
        writePastePayload,
      }: {
        isBracketedPasteMode?: () => boolean
        writePastePayload: (data: string) => void
      }) => {
        writePastePayload('clipboard payload')
      },
    )
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
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

    handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue,
      terminal: {
        hasSelection: () => false,
        getSelection: () => '',
      },
    })

    await Promise.resolve()

    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('clipboard payload')
    expect(ptyWriteQueue.flush).toHaveBeenCalledTimes(1)
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
      },
    })

    expect(result).toBe(false)
    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u001b\r')
    expect(ptyWriteQueue.flush).toHaveBeenCalledTimes(1)
  })

  it('pastes clipboard text on macOS Cmd+V', () => {
    const pasteClipboardText = vi.fn()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
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
    }

    const result = handleTerminalCustomKeyEvent({
      event,
      pasteClipboardText,
      platformInfo: { platform: 'MacIntel' },
      ptyWriteQueue,
      terminal,
    })

    expect(result).toBe(false)
    expect(pasteClipboardText).toHaveBeenCalledWith({
      isBracketedPasteMode: undefined,
      writePastePayload: expect.any(Function),
    })
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
      },
    })

    expect(result).toBe(true)
    expect(pasteClipboardText).not.toHaveBeenCalled()
  })
})
