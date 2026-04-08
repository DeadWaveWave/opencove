import { describe, expect, it, vi } from 'vitest'
import { handleTerminalCustomKeyEvent } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputBridge'
import { createWindowsAutomationPasteGuard } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/windowsAutomationPasteGuard'

describe('handleTerminalCustomKeyEvent Windows guard', () => {
  it('logs Windows Ctrl+C pass-through when there is no selection', () => {
    const logShortcutDecision = vi.fn()

    const result = handleTerminalCustomKeyEvent({
      event: new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
      logShortcutDecision,
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
    expect(logShortcutDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'copy-interrupt',
        eventType: 'keydown',
        hasSelection: false,
        isPhysicalKeyCodeMissing: true,
        key: 'c',
        platform: 'windows',
        windowsCopyShortcut: true,
      }),
    )
  })

  it('logs Windows paste decisions', () => {
    const logShortcutDecision = vi.fn()

    const result = handleTerminalCustomKeyEvent({
      event: new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true }),
      logShortcutDecision,
      pasteClipboardText: vi.fn(),
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

    expect(result).toBe(false)
    expect(logShortcutDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'paste',
        eventType: 'keydown',
        hasSelection: false,
        key: 'v',
        platform: 'windows',
        windowsPasteShortcut: true,
      }),
    )
  })

  it('defers Windows Ctrl+C passthrough when the automation paste guard is enabled', () => {
    const automationPasteGuard = {
      cancelPendingInterrupt: vi.fn(() => false),
      dispose: vi.fn(),
      noteColumnSelectionMode: vi.fn(),
      noteKeyboardEvent: vi.fn(),
      noteManualPointerInteraction: vi.fn(),
      noteSelectionChange: vi.fn(),
      scheduleInterrupt: vi.fn(),
      shouldSuppressSelectionCopy: vi.fn(() => false),
    }
    const event = {
      type: 'keydown',
      key: 'c',
      code: '',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      repeat: false,
    } as unknown as KeyboardEvent

    const result = handleTerminalCustomKeyEvent({
      automationPasteGuard,
      event,
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

    expect(result).toBe(false)
    expect(automationPasteGuard.noteKeyboardEvent).toHaveBeenCalledTimes(1)
    expect(automationPasteGuard.scheduleInterrupt).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('does not defer Windows Ctrl+C passthrough when a physical key code is present', () => {
    const automationPasteGuard = {
      cancelPendingInterrupt: vi.fn(() => false),
      dispose: vi.fn(),
      noteColumnSelectionMode: vi.fn(),
      noteKeyboardEvent: vi.fn(),
      noteManualPointerInteraction: vi.fn(),
      noteSelectionChange: vi.fn(),
      scheduleInterrupt: vi.fn(),
      shouldSuppressSelectionCopy: vi.fn(() => false),
    }

    const result = handleTerminalCustomKeyEvent({
      automationPasteGuard,
      event: new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true }),
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
    expect(automationPasteGuard.scheduleInterrupt).not.toHaveBeenCalled()
  })

  it('cancels a pending automation interrupt before Windows paste', () => {
    const automationPasteGuard = {
      cancelPendingInterrupt: vi.fn(() => true),
      dispose: vi.fn(),
      noteColumnSelectionMode: vi.fn(),
      noteKeyboardEvent: vi.fn(),
      noteManualPointerInteraction: vi.fn(),
      noteSelectionChange: vi.fn(),
      scheduleInterrupt: vi.fn(),
      shouldSuppressSelectionCopy: vi.fn(() => false),
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
      repeat: false,
    } as unknown as KeyboardEvent
    const pasteClipboardText = vi.fn()

    const result = handleTerminalCustomKeyEvent({
      automationPasteGuard,
      event,
      pasteClipboardText,
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

    expect(result).toBe(false)
    expect(automationPasteGuard.cancelPendingInterrupt).toHaveBeenCalledTimes(1)
    expect(pasteClipboardText).toHaveBeenCalledTimes(1)
  })

  it('clears an existing selection before a guarded Windows paste', () => {
    const clearSelection = vi.fn()
    const automationPasteGuard = {
      cancelPendingInterrupt: vi.fn(() => true),
      dispose: vi.fn(),
      noteColumnSelectionMode: vi.fn(),
      noteKeyboardEvent: vi.fn(),
      noteManualPointerInteraction: vi.fn(),
      noteSelectionChange: vi.fn(),
      scheduleInterrupt: vi.fn(),
      shouldSuppressSelectionCopy: vi.fn(() => false),
    }

    const result = handleTerminalCustomKeyEvent({
      automationPasteGuard,
      event: {
        type: 'keydown',
        key: 'v',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        repeat: false,
      } as unknown as KeyboardEvent,
      pasteClipboardText: vi.fn(),
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal: {
        clearSelection,
        hasSelection: () => true,
        getSelection: () => 'selected output',
        paste: vi.fn(),
      },
    })

    expect(result).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })

  it('suppresses copy-selection when the automation guard marks the selection as suspicious', () => {
    const clearSelection = vi.fn()
    const copySelectedText = vi.fn(async () => undefined)
    const automationPasteGuard = {
      cancelPendingInterrupt: vi.fn(() => false),
      dispose: vi.fn(),
      noteColumnSelectionMode: vi.fn(),
      noteKeyboardEvent: vi.fn(),
      noteManualPointerInteraction: vi.fn(),
      noteSelectionChange: vi.fn(),
      scheduleInterrupt: vi.fn(),
      shouldSuppressSelectionCopy: vi.fn(() => true),
    }
    const event = {
      type: 'keydown',
      key: 'c',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      repeat: false,
    } as unknown as KeyboardEvent

    const result = handleTerminalCustomKeyEvent({
      automationPasteGuard,
      copySelectedText,
      event,
      platformInfo: { platform: 'Win32' },
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
      terminal: {
        clearSelection,
        hasSelection: () => true,
        getSelection: () => 'selected output',
        paste: vi.fn(),
      },
    })

    expect(result).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(1)
    expect(copySelectedText).not.toHaveBeenCalled()
  })
})

describe('createWindowsAutomationPasteGuard', () => {
  it('writes a delayed interrupt to the PTY queue', async () => {
    vi.useFakeTimers()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      ptyWriteQueue,
    })

    guard.scheduleInterrupt()
    await vi.advanceTimersByTimeAsync(49)

    expect(ptyWriteQueue.enqueue).not.toHaveBeenCalled()
    expect(ptyWriteQueue.flush).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u0003')
    expect(ptyWriteQueue.flush).toHaveBeenCalledTimes(1)
    guard.dispose()
    vi.useRealTimers()
  })

  it('extends the delayed interrupt window after repeated hotkey keydowns', async () => {
    vi.useFakeTimers()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      modifierStormDelayMs: 200,
      modifierStormRepeatThreshold: 3,
      modifierStormWindowMs: 250,
      ptyWriteQueue,
    })

    guard.noteKeyboardEvent({
      type: 'keydown',
      key: 'F8',
      code: 'F8',
      repeat: true,
    })
    guard.noteKeyboardEvent({
      type: 'keydown',
      key: 'F8',
      code: 'F8',
      repeat: true,
    })
    guard.noteKeyboardEvent({
      type: 'keydown',
      key: 'F8',
      code: 'F8',
      repeat: true,
    })

    guard.scheduleInterrupt()
    await vi.advanceTimersByTimeAsync(50)

    expect(ptyWriteQueue.enqueue).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(150)

    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u0003')
    expect(ptyWriteQueue.flush).toHaveBeenCalledTimes(1)
    guard.dispose()
    vi.useRealTimers()
  })

  it('keeps the repeated hotkey storm active briefly after keyup', async () => {
    vi.useFakeTimers()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      modifierStormDelayMs: 200,
      modifierStormRepeatThreshold: 3,
      modifierStormWindowMs: 250,
      ptyWriteQueue,
    })

    guard.noteKeyboardEvent({
      type: 'keydown',
      key: 'F8',
      code: 'F8',
      repeat: true,
    })
    guard.noteKeyboardEvent({
      type: 'keydown',
      key: 'F8',
      code: 'F8',
      repeat: true,
    })
    guard.noteKeyboardEvent({
      type: 'keydown',
      key: 'F8',
      code: 'F8',
      repeat: true,
    })
    guard.noteKeyboardEvent({
      type: 'keyup',
      key: 'F8',
      code: 'F8',
      repeat: false,
    })

    guard.scheduleInterrupt()
    await vi.advanceTimersByTimeAsync(50)

    expect(ptyWriteQueue.enqueue).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(150)

    expect(ptyWriteQueue.enqueue).toHaveBeenCalledWith('\u0003')
    expect(ptyWriteQueue.flush).toHaveBeenCalledTimes(1)
    guard.dispose()
    vi.useRealTimers()
  })

  it('cancels a pending delayed interrupt', async () => {
    vi.useFakeTimers()
    const ptyWriteQueue = {
      enqueue: vi.fn(),
      flush: vi.fn(),
    }
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      ptyWriteQueue,
    })

    guard.scheduleInterrupt()
    guard.cancelPendingInterrupt()
    await vi.advanceTimersByTimeAsync(50)

    expect(ptyWriteQueue.enqueue).not.toHaveBeenCalled()
    expect(ptyWriteQueue.flush).not.toHaveBeenCalled()
    guard.dispose()
    vi.useRealTimers()
  })

  it('clears a suspicious selection that appears shortly after an automation paste', async () => {
    vi.useFakeTimers()
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
    })
    const clearSelection = vi.fn()

    guard.scheduleInterrupt()
    guard.cancelPendingInterrupt()
    guard.noteSelectionChange(true, clearSelection)

    expect(clearSelection).toHaveBeenCalledTimes(1)
    guard.dispose()
    vi.useRealTimers()
  })

  it('does not clear a selection right after manual pointer interaction', async () => {
    vi.useFakeTimers()
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
    })
    const clearSelection = vi.fn()

    guard.scheduleInterrupt()
    guard.cancelPendingInterrupt()
    guard.noteManualPointerInteraction()
    guard.noteSelectionChange(true, clearSelection)

    expect(clearSelection).not.toHaveBeenCalled()
    guard.dispose()
    vi.useRealTimers()
  })

  it('clears a suspicious column selection that appears after an automation paste', async () => {
    vi.useFakeTimers()
    const guard = createWindowsAutomationPasteGuard({
      delayMs: 50,
      ptyWriteQueue: {
        enqueue: vi.fn(),
        flush: vi.fn(),
      },
    })
    const clearSelection = vi.fn()

    guard.scheduleInterrupt()
    guard.cancelPendingInterrupt()
    guard.noteColumnSelectionMode(true, clearSelection)

    expect(clearSelection).toHaveBeenCalledTimes(1)
    guard.dispose()
    vi.useRealTimers()
  })
})
