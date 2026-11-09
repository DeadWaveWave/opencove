import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'
import { readTerminalEmulationStateForTest } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'

const grid = { cols: 80, rows: 12 }
const disposables: Array<{ dispose(): void }> = []
const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const createTerminal = () => {
  const terminal = new Terminal({ ...grid, allowProposedApi: true, convertEol: true })
  disposables.push(terminal)
  return terminal
}
const createWorker = () => {
  const worker = new TerminalPresentationSession({ sessionId: 'restore-state', ...grid })
  disposables.push(worker)
  return worker
}
function project(terminal: Terminal) {
  return {
    ...readTerminalEmulationStateForTest(terminal),
    modes: terminal.modes,
    cursor: [terminal.buffer.active.cursorX, terminal.buffer.active.cursorY],
    normal: Array.from({ length: terminal.buffer.normal.length }, (_, i) =>
      terminal.buffer.normal.getLine(i)?.translateToString(true),
    ),
    active: Array.from({ length: terminal.buffer.active.length }, (_, i) =>
      terminal.buffer.active.getLine(i)?.translateToString(true),
    ),
  }
}
async function hydrate(terminal: Terminal, worker: TerminalPresentationSession) {
  const snapshot = await worker.snapshot()
  await hydrateTerminalFromSnapshot({
    terminal,
    sessionId: snapshot.sessionId,
    kind: 'agent',
    attachPromise: Promise.resolve(undefined),
    cachedScreenState: null,
    persistedSnapshot: '',
    presentationSnapshotPromise: Promise.resolve(snapshot),
    takePtySnapshot: vi.fn(async () => ({ data: '' })),
    isDisposed: () => false,
    onHydratedWriteCommitted: vi.fn(),
    finalizeHydration: vi.fn(),
  })
  return snapshot
}
afterEach(() =>
  disposables
    .splice(0)
    .reverse()
    .forEach(item => item.dispose()),
)

describe('Worker snapshot → real renderer terminal state', () => {
  it('restores modes and the active buffer even when the authoritative screen has no text', async () => {
    const worker = createWorker(),
      source = createTerminal(),
      renderer = createTerminal()
    const data = '\x1b[?1049h\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?25l'
    await Promise.all([worker.applyOutput(1, data), write(source, data)])
    await hydrate(renderer, worker)
    expect(project(renderer)).toEqual(project(source))
  })
  it.each(['\x1b[?1006h', '\x1b[?1016h'])(
    'round-trips alternate screen and input modes with encoding %j',
    async encoding => {
      const worker = createWorker(),
        source = createTerminal(),
        renderer = createTerminal()
      const data =
        'NORMAL_HISTORY_1\r\nNORMAL_HISTORY_2' +
        '\x1b[?1049h\x1b[?2004h\x1b[?1003h' +
        encoding +
        '\x1b[?1h\x1b[?66h\x1b[?1004h\x1b[?25l\x1b[?7l\x1b[?6h' +
        'ALT_HISTORY_1\r\nALT_HISTORY_2'
      await Promise.all([worker.applyOutput(1, data), write(source, data)])
      const snapshot = await hydrate(renderer, worker)
      expect(snapshot.bufferKind).toBe('alternate')
      expect(project(renderer)).toEqual(project(source))
      expect(snapshot.serializedScreen).not.toContain('$p')
    },
  )

  it('restores a normal/default snapshot over a stale alternate renderer', async () => {
    const worker = createWorker(),
      source = createTerminal(),
      renderer = createTerminal()
    await write(renderer, '\x1b[?1049hOLD_ALT\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1h\x1b[?25l')
    await Promise.all([worker.applyOutput(1, 'NORMAL_CURRENT'), write(source, 'NORMAL_CURRENT')])
    await hydrate(renderer, worker)
    expect(project(renderer)).toEqual(project(source))
  })

  it('restores default input modes while archiving a previous terminal epoch', async () => {
    const worker = createWorker(),
      renderer = createTerminal()
    await worker.applyOutput(1, 'NORMAL_CURRENT')
    const snapshot = await worker.snapshot()
    await hydrateTerminalFromSnapshot({
      terminal: renderer,
      sessionId: snapshot.sessionId,
      kind: 'terminal',
      runtimeEpochChanged: true,
      attachPromise: Promise.resolve(undefined),
      cachedScreenState: null,
      persistedSnapshot: '\x1b[?1049hARCHIVE_OLD\x1b[?2004h\x1b[?1003h\x1b[?1h',
      presentationSnapshotPromise: Promise.resolve(snapshot),
      takePtySnapshot: vi.fn(async () => ({ data: '' })),
      isDisposed: () => false,
      onHydratedWriteCommitted: vi.fn(),
      finalizeHydration: vi.fn(),
    })
    expect(readTerminalEmulationStateForTest(renderer)).toMatchObject({
      bufferKind: 'normal',
      bracketedPasteMode: false,
      mouseTrackingMode: 'none',
      applicationCursorKeysMode: false,
    })
    expect(project(renderer).normal.join('\n')).toContain('ARCHIVE_OLD')
    expect(project(renderer).active.join('\n')).toContain('NORMAL_CURRENT')
  })

  it('keeps snapshot sequence and mode capture in the same Worker FIFO operation', async () => {
    const worker = createWorker()
    await worker.applyOutput(1, '\x1b[?1049h\x1b[?2004h\x1b[?1003h\x1b[?1006hONE')
    const snapshotPromise = worker.snapshot()
    const later = worker.applyOutput(2, '\x1b[?2004l\x1b[?1006lTWO')
    const snapshot = await snapshotPromise
    await later
    const renderer = createTerminal()
    await write(renderer, snapshot.serializedScreen)
    expect(snapshot.appliedSeq).toBe(1)
    expect(readTerminalEmulationStateForTest(renderer)).toMatchObject({
      bracketedPasteMode: true,
      mouseEncoding: 'SGR',
    })
    expect(project(renderer).active.join('\n')).not.toContain('TWO')
  })

  it('restores origin coordinates and custom scrolling margins for subsequent output', async () => {
    const worker = createWorker(),
      source = createTerminal(),
      renderer = createTerminal()
    const data = '\x1b[?1049h\x1b[2;10r\x1b[?6h\x1b[2;1HREGION'
    await Promise.all([worker.applyOutput(1, data), write(source, data)])
    await hydrate(renderer, worker)
    expect(project(renderer)).toEqual(project(source))
    await Promise.all([
      write(renderer, '\x1b[9;1Hlast\r\nnext'),
      write(source, '\x1b[9;1Hlast\r\nnext'),
    ])
    expect(project(renderer)).toEqual(project(source))
  })

  it('does not disturb the add-on wrap-pending cursor state', async () => {
    const worker = createWorker(),
      source = createTerminal(),
      renderer = createTerminal()
    const data = 'x'.repeat(grid.cols)
    await Promise.all([worker.applyOutput(1, data), write(source, data)])
    await hydrate(renderer, worker)
    await Promise.all([write(renderer, 'next'), write(source, 'next')])
    expect(project(renderer)).toEqual(project(source))
  })

  it('does not mix later geometry revisions into an earlier snapshot', async () => {
    const worker = createWorker()
    await worker.applyOutput(1, 'GEOMETRY')
    const pending = worker.snapshot()
    worker.resize(100, 20, 2)
    const snapshot = await pending
    expect([snapshot.cols, snapshot.rows, snapshot.geometryRevision]).toEqual([80, 12, null])
    expect((await worker.snapshot()).geometryRevision).toBe(2)
  })

  it.each([
    { prefix: '\x1b[?1006', suffix: 'hREADY', encoding: 'SGR', title: null },
    {
      prefix: '\x1b]0;EXPECTED_TITLE',
      suffix: '\x07READY',
      encoding: 'DEFAULT',
      title: 'EXPECTED_TITLE',
    },
  ])(
    'taking a snapshot never mutates a partial parser sequence: $prefix',
    async ({ prefix, suffix, encoding, title }) => {
      const worker = createWorker(),
        renderer = createTerminal()
      await worker.applyOutput(1, prefix)
      await worker.snapshot()
      await worker.applyOutput(2, suffix)
      const snapshot = await hydrate(renderer, worker)
      expect(snapshot.title).toBe(title)
      expect(readTerminalEmulationStateForTest(renderer).mouseEncoding).toBe(encoding)
      expect(project(renderer).active.join('\n')).toContain('READY')
    },
  )
})
