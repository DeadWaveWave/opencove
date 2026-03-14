import { describe, expect, it, vi } from 'vitest'
import { handleTerminalCustomKeyEvent } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputBridge'

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

  it('does not intercept Windows Ctrl+V so xterm can handle paste', () => {
    const result = handleTerminalCustomKeyEvent({
      event: new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }),
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
})
