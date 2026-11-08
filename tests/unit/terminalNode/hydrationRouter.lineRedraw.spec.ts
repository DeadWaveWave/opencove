import { Terminal } from '@xterm/xterm'
import { SerializeAddon } from '@xterm/addon-serialize'
import { describe, expect, it, vi } from 'vitest'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'
import { createRollingTextBuffer } from '../../../src/contexts/workspace/presentation/renderer/utils/rollingTextBuffer'

const history = Array.from({ length: 36 }, (_, index) => `HISTORY_${index + 1}_KEPT`)
const baseline = `${history.join('\r\n')}\r\nold status`
const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const text = (terminal: Terminal) =>
  Array.from({ length: terminal.buffer.active.length }, (_, index) =>
    terminal.buffer.active.getLine(index)?.translateToString(true),
  ).join('\n')

async function reproduce(
  chunks: string[],
  seq = 6,
  replaceAgentBaseline = true,
  afterHydration = false,
) {
  const terminal = new Terminal({ cols: 80, rows: 12, scrollback: 1000, allowProposedApi: true })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer)
  try {
    await write(terminal, baseline)
    const snapshot = serializer.serialize()
    const before = text(terminal)
    const buffer = () => createRollingTextBuffer({ maxChars: 100_000, initial: snapshot })
    const router = createTerminalHydrationRouter({
      terminal,
      outputScheduler: { handleChunk: data => terminal.write(data) },
      // A Worker presentation snapshot is authoritative, not a legacy placeholder.
      shouldReplaceAgentPlaceholderAfterHydration: () => false,
      shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => replaceAgentBaseline,
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
    for (const chunk of chunks) {
      router.handleDataChunk(chunk, { seq })
    }
    if (!afterHydration) {
      router.finalizeHydration(snapshot, { baselineAppliedSeq: 5 })
    }
    // Drain the actual xterm write queue, including the router's possible ESC c prefix.
    await write(terminal, '')
    return { before, after: text(terminal) }
  } finally {
    terminal.dispose()
  }
}

describe('agent authoritative hydration baseline with line-only redraw', () => {
  // Synthetic Claude-like spinner pattern from #569, NOT a claimed capture of real Claude.
  // Regression: line redraws retain the accepted baseline and its scrollback.
  it.each(['\x1b[K', '\x1b[0K', '\x1b[1K', '\x1b[2K'])(
    'preserves static history when fresh %j + status arrives during hydration',
    async erase => {
      const result = await reproduce([`\r${erase}* Working...`])
      expect(result.before).toContain(history[0])
      expect(result.after).toContain('* Working...')
      expect(result.after, 'line erase must not reset the screen or scrollback').toContain(
        history[0],
      )
      expect(result.after).toContain(history.at(-1))
    },
  )

  it('preserves history with an escape sequence split across PTY chunks', async () => {
    const result = await reproduce(['\r\x1b[2', 'K', '* Working...'])
    expect(result.after).toContain('* Working...')
    expect(result.after).toContain(history[0])
  })

  it('preserves history when the same redraw arrives after hydration (timing control)', async () => {
    const result = await reproduce(['\r\x1b[2K* Working...'], 6, true, true)
    expect(result.after).toContain(history[0])
    expect(result.after).toContain(history.at(-1))
    expect(result.after).toContain('* Working...')
  })

  it('preserves history under the plain terminal policy (emulator control)', async () => {
    const result = await reproduce(['\r\x1b[2K* Working...'], 6, false)
    expect(result.after).toContain(history[0])
    expect(result.after).toContain('* Working...')
  })

  it('does not replay a line redraw already covered by the snapshot fence', async () => {
    const result = await reproduce(['\r\x1b[2K* duplicate status'], 5)
    expect(result.after).toContain(history[0])
    expect(result.after).not.toContain('duplicate status')
  })

  it.each(['\x1b[J', '\x1b[0J', '\x1b[1J', '\x1b[3J'])(
    'replays display erasure %j without upgrading it to a whole-state reset',
    async erase => {
      const result = await reproduce([`\r${erase}partial redraw`])
      // ED3 legitimately erases scrollback; ED0/1 must not do so.
      expect(result.after).toContain(erase === '\x1b[3J' ? history.at(-1)! : history[0])
    },
  )

  it('retains the historical full-screen frame replacement contract from #191', async () => {
    const result = await reproduce(['\x1b[2J\x1b[Hfresh full frame'])
    expect(result.after).toContain('fresh full frame')
    expect(result.after).not.toContain(history[0])
  })
})
