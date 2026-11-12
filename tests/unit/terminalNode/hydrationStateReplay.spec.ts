import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'
import { readTerminalEmulationStateForTest } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'
import { createRollingTextBuffer } from '../../../src/contexts/workspace/presentation/renderer/utils/rollingTextBuffer'

const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const enable = '\x1b[?2004h\x1b[?1003h\x1b[?1006h'
const otherModes = '\x1b[?1h\x1b[?66h\x1b[?7l'

describe.each(['agent', 'terminal'] as const)('snapshot-in-flight state replay: %s', kind => {
  it.each(['separate answered query', 'mixed unanswered query', 'covered controls'])(
    'preserves the sequence fence and query-once contract: %s',
    async scenario => {
      const terminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true })
      const worker = new TerminalPresentationSession({
        sessionId: 'state-replay',
        cols: 40,
        rows: 8,
      })
      const replies: string[] = []
      const listener = terminal.onData(data => replies.push(data))
      let disposed = false
      const buffer = () => createRollingTextBuffer({ maxChars: 10_000 })
      const router = createTerminalHydrationRouter({
        terminal,
        outputScheduler: { handleChunk: data => terminal.write(data) },
        shouldReplaceAgentPlaceholderAfterHydration: () => false,
        shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => kind === 'agent',
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
        isDisposed: () => disposed,
      })
      try {
        await worker.applyOutput(1, 'BASELINE')
        if (scenario === 'covered controls') {
          await worker.applyOutput(2, enable + otherModes)
          await worker.applyOutput(3, '\x1b[?2004l\x1b[?1003l\x1b[?1006l\x1b[?1l\x1b[?66l\x1b[?7h')
        }
        const snapshot = await worker.snapshot()
        let deliver!: (value: typeof snapshot) => void
        const pending = hydrateTerminalFromSnapshot({
          terminal,
          sessionId: snapshot.sessionId,
          kind,
          attachPromise: Promise.resolve(undefined),
          presentationSnapshotPromise: new Promise(resolve => {
            deliver = resolve
          }),
          persistedSnapshot: '',
          cachedScreenState: null,
          takePtySnapshot: vi.fn(),
          isDisposed: () => disposed,
          onHydratedWriteCommitted: vi.fn(),
          finalizeHydration: (data, options) => router.finalizeHydration(data, options),
        })
        if (scenario === 'mixed unanswered query') {
          router.handleDataChunk(`${enable}${otherModes}\x1b[c`, { seq: 2 })
        } else {
          router.handleDataChunk(enable, { seq: 2 })
          router.handleDataChunk(otherModes, { seq: 2 })
          router.handleDataChunk('\x1b[c', { seq: 4 })
          await write(terminal, '')
          expect(readTerminalEmulationStateForTest(terminal)).toMatchObject({
            bracketedPasteMode: true,
            mouseTrackingMode: 'any',
            mouseEncoding: 'SGR',
          })
          expect(replies).toHaveLength(1)
        }
        deliver(snapshot)
        await pending
        await write(terminal, '')
        const covered = scenario === 'covered controls'
        expect(readTerminalEmulationStateForTest(terminal)).toMatchObject({
          bracketedPasteMode: !covered,
          mouseTrackingMode: covered ? 'none' : 'any',
          mouseEncoding: covered ? 'DEFAULT' : 'SGR',
          applicationCursorKeysMode: !covered,
          applicationKeypadMode: !covered,
          wraparoundMode: covered,
        })
        expect(replies).toHaveLength(1)
        expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('BASELINE')
      } finally {
        disposed = true
        listener.dispose()
        terminal.dispose()
        worker.dispose()
      }
    },
  )
})
