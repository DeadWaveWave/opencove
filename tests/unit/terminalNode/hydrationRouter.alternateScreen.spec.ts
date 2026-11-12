import { Terminal } from '@xterm/xterm'
import { SerializeAddon } from '@xterm/addon-serialize'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'
import {
  observeTerminalWritesForTest,
  readTerminalEmulationStateForTest,
  readTerminalWritesForTest,
} from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'
import { createRollingTextBuffer } from '../../../src/contexts/workspace/presentation/renderer/utils/rollingTextBuffer'
import { serializeTerminalState } from '../../../src/platform/terminal/presentation/serializeTerminalState'

const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const visible = (terminal: Terminal) =>
  Array.from({ length: terminal.rows }, (_, i) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + i)?.translateToString(true),
  ).join('\n')

async function reproduce({
  seq = 6,
  afterHydration = false,
  agentPolicy = true,
  redraw = true,
  data = '\r\x1b[2K* Working...',
} = {}) {
  const options = { cols: 80, rows: 12, allowProposedApi: true }
  const source = new Terminal(options)
  const terminal = new Terminal(options)
  const serializer = new SerializeAddon()
  source.loadAddon(serializer)
  const stopCapture = observeTerminalWritesForTest(terminal)
  try {
    await write(source, 'normal buffer sentinel')
    await write(
      source,
      '\x1b[?1049hALT_STATIC_001\r\nALT_STATIC_002\r\nold status' +
        '\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1h\x1b[?66h\x1b[?1004h\x1b[?25l',
    )
    const snapshot = serializeTerminalState(source, serializer)
    expect(snapshot).toContain('\x1b[?1049h')
    expect(snapshot).toContain('\x1b[?2004h')
    expect(snapshot).toContain('\x1b[?1003h')
    await write(terminal, snapshot)
    const before = readTerminalEmulationStateForTest(terminal)
    expect(before).toMatchObject({
      bufferKind: 'alternate',
      bracketedPasteMode: true,
      mouseTrackingMode: 'any',
      mouseEncoding: 'SGR',
      applicationCursorKeysMode: true,
      applicationKeypadMode: true,
      sendFocusMode: true,
      cursorVisible: false,
    })
    const buffer = () => createRollingTextBuffer({ maxChars: 100_000, initial: snapshot })
    const router = createTerminalHydrationRouter({
      terminal,
      outputScheduler: { handleChunk: chunk => terminal.write(chunk) },
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => agentPolicy,
      shouldDeferHydratedRedrawChunks: () => true,
      scrollbackBuffer: buffer(),
      committedScrollbackBuffer: buffer(),
      recordCommittedScreenState: vi.fn(),
      scheduleTranscriptSync: vi.fn(),
      ptyWriteQueue: { flush: vi.fn() },
      markScrollbackDirty: vi.fn(),
      logHydrated: vi.fn(),
      syncTerminalSize: vi.fn(),
      onRevealed: vi.fn(),
      isDisposed: () => false,
    })
    if (afterHydration) {
      router.finalizeHydration(snapshot, { baselineAppliedSeq: 5 })
    }
    if (redraw) {
      router.handleDataChunk(data, { seq })
    }
    if (!afterHydration) {
      router.finalizeHydration(snapshot, { baselineAppliedSeq: 5 })
    }
    await write(terminal, '')
    return {
      before,
      after: readTerminalEmulationStateForTest(terminal),
      visible: visible(terminal),
      writes: readTerminalWritesForTest(terminal),
    }
  } finally {
    stopCapture()
    terminal.dispose()
    source.dispose()
  }
}

describe('alternate-screen authoritative hydration', () => {
  it('preserves the alternate buffer and its modes across a fresh buffered line-only redraw', async () => {
    const result = await reproduce()
    // Regression: a line-only redraw must not introduce a reset.
    expect
      .soft(result.after, 'line erase must preserve accepted buffer/modes')
      .toEqual(result.before)
    expect.soft(result.visible).toContain('ALT_STATIC_001')
    expect.soft(result.visible).toContain('* Working...')
    expect.soft(result.writes.some(record => record.data.includes('\x1bc'))).toBe(false)
  })

  it('replaces a full viewport frame without resetting buffer or input modes', async () => {
    const result = await reproduce({ data: '\x1b[2J\x1b[Hfresh full frame' })
    expect(result.after).toEqual(result.before)
    expect(result.visible).toContain('fresh full frame')
    expect(result.visible).not.toContain('ALT_STATIC_001')
    expect(result.writes.some(record => record.containsRIS)).toBe(false)
  })

  it('lets an explicit alternate exit return to the serialized normal buffer behind it', async () => {
    const result = await reproduce({ data: '\x1b[?1049lNORMAL_RETURN' })
    expect(result.after.bufferKind).toBe('normal')
    expect(result.after.bracketedPasteMode).toBe(true)
    expect(result.visible).toContain('normal buffer sentinel')
    expect(result.visible).toContain('NORMAL_RETURN')
    expect(result.writes.some(record => record.containsRIS)).toBe(false)
  })

  it.each([
    { label: 'after hydration', afterHydration: true },
    { label: 'covered snapshot sequence', seq: 5 },
    { label: 'plain terminal policy', agentPolicy: false },
    { label: 'no buffered redraw', redraw: false },
  ])('preserves alternate state for $label (control)', async options => {
    const result = await reproduce(options)
    expect(result.after).toEqual(result.before)
    expect(result.visible).toContain('ALT_STATIC_001')
    expect(result.writes.some(record => record.data.includes('\x1bc'))).toBe(false)
  })
})
