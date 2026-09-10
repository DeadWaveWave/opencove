import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalClipboardHandler,
  resolveTerminalImagePasteSequence,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalClipboard'

describe('terminal clipboard routing', () => {
  it('reads provider changes without replacing the terminal clipboard handler', () => {
    let provider: string | null = null
    const write = vi.fn()
    const readClipboard = vi.fn()
    const handle = createTerminalClipboardHandler({
      provider: null,
      getProvider: () => provider,
      platform: 'win32',
      write,
      readClipboard,
      isDisposed: () => false,
      isBracketedPasteMode: () => false,
    })
    const press = () => handle(new KeyboardEvent('keydown', { key: 'v', altKey: true }))
    expect(press()).toBe(false)
    provider = 'pi'
    expect(press()).toBe(true)
    expect(write).toHaveBeenLastCalledWith('\u001bv')
    provider = 'kimi'
    expect(press()).toBe(true)
    expect(write).toHaveBeenLastCalledWith('\u0016')
    provider = null
    expect(press()).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
    expect(readClipboard).not.toHaveBeenCalled()
  })
  it('drops an image read that completes after disposal', async () => {
    let complete!: (value: { text: string; hasImage: boolean }) => void
    const read = new Promise<{ text: string; hasImage: boolean }>(resolve => {
      complete = resolve
    })
    let disposed = false
    const write = vi.fn()
    const handle = createTerminalClipboardHandler({
      provider: 'pi',
      platform: 'darwin',
      write,
      readClipboard: () => read,
      isDisposed: () => disposed,
      isBracketedPasteMode: () => false,
    })
    handle(new KeyboardEvent('keydown', { key: 'v', metaKey: true }))
    disposed = true
    complete({ text: '', hasImage: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    ['pi', '\u001bv'],
    ['kimi', '\u0016'],
    ['codex', '\u0016'],
    ['claude-code', '\u001bv'],
  ])('routes Windows Alt+V images for %s once', async (provider, expected) => {
    const write = vi.fn()
    const handle = createTerminalClipboardHandler({
      provider: provider!,
      platform: 'win32',
      write,
      readClipboard: async () => ({ text: '', hasImage: true }),
      isDisposed: () => false,
      isBracketedPasteMode: () => true,
    })
    expect(handle(new KeyboardEvent('keydown', { key: 'v', altKey: true }))).toBe(true)
    await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith(expected))
  })
  it.each([
    ['pi', 'win32', '\u001bv'],
    ['pi', 'darwin', '\u0016'],
    ['kimi', 'win32', '\u0016'],
    ['codex', 'darwin', '\u0016'],
    ['claude-code', 'win32', '\u001bv'],
    ['claude-code', 'darwin', '\u0016'],
    [null, 'darwin', '\u0016'],
  ])('maps %s on %s to its native image binding', (provider, platform, sequence) => {
    expect(resolveTerminalImagePasteSequence(provider, platform!)).toBe(sequence)
  })

  it.each(['pi', 'kimi', 'codex', 'claude-code', null])(
    'routes macOS images for %s without text or bracket wrappers',
    async provider => {
      const write = vi.fn()
      const handle = createTerminalClipboardHandler({
        provider,
        platform: 'darwin',
        write,
        readClipboard: async () => ({ text: 'image label', hasImage: true }),
        isDisposed: () => false,
        isBracketedPasteMode: () => true,
      })
      expect(handle(new KeyboardEvent('keydown', { key: 'v', metaKey: true }))).toBe(true)
      await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith('\u0016'))
    },
  )

  it('preserves shell Alt+V', () => {
    const readClipboard = vi.fn()
    const handle = createTerminalClipboardHandler({
      provider: null,
      platform: 'win32',
      readClipboard,
      write: vi.fn(),
      isDisposed: () => false,
      isBracketedPasteMode: () => false,
    })
    expect(handle(new KeyboardEvent('keydown', { key: 'v', altKey: true }))).toBe(false)
    expect(readClipboard).not.toHaveBeenCalled()
  })

  it('preserves text normalization and bracketed paste', async () => {
    const write = vi.fn()
    const handle = createTerminalClipboardHandler({
      provider: 'kimi',
      platform: 'win32',
      write,
      readClipboard: async () => ({ text: 'one\ntwo', hasImage: false }),
      isDisposed: () => false,
      isBracketedPasteMode: () => true,
    })
    handle(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledExactlyOnceWith('\u001b[200~one\rtwo\u001b[201~'),
    )
  })
})
