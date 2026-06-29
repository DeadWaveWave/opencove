import { describe, expect, it, vi } from 'vitest'
import {
  createPtyWriteQueue,
  pasteTextFromClipboard,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/inputBridge'
import { createTerminalInputModeTracker } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalInputModes'

describe('pasteTextFromClipboard', () => {
  it('normalizes clipboard text before forwarding the paste payload', async () => {
    const readClipboardText = vi.fn(async () => 'clipboard\npayload')
    const writePastePayload = vi.fn()

    await pasteTextFromClipboard({
      readClipboardText,
      writePastePayload,
    })

    expect(readClipboardText).toHaveBeenCalledTimes(1)
    expect(writePastePayload).toHaveBeenCalledWith('clipboard\rpayload')
  })

  it('wraps clipboard text when bracketed paste mode is enabled', async () => {
    const readClipboardText = vi.fn(async () => 'clipboard payload')
    const writePastePayload = vi.fn()

    await pasteTextFromClipboard({
      isBracketedPasteMode: () => true,
      readClipboardText,
      writePastePayload,
    })

    expect(writePastePayload).toHaveBeenCalledWith('\u001b[200~clipboard payload\u001b[201~')
  })
})

describe('createPtyWriteQueue', () => {
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

describe('terminal input mode tracker', () => {
  it('tracks bracketed paste mode across split PTY output chunks', () => {
    const tracker = createTerminalInputModeTracker()

    expect(tracker.isBracketedPasteMode()).toBe(false)

    tracker.handlePtyOutputChunk('\u001b[?20')
    tracker.handlePtyOutputChunk('04hready')

    expect(tracker.isBracketedPasteMode()).toBe(true)

    tracker.handlePtyOutputChunk('\u001b[?1000h\u001b[?2004l')

    expect(tracker.isBracketedPasteMode()).toBe(false)
  })
})
