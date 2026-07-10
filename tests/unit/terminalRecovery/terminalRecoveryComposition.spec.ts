import { describe, expect, it } from 'vitest'
import { Terminal } from '@xterm/xterm'
import {
  composeTerminalRecoveryScrollback,
  type TerminalRecoveryRecord,
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'

describe('terminal recovery epoch composition', () => {
  it('keeps three epochs visible and resets archived xterm modes before the new shell', async () => {
    const record: TerminalRecoveryRecord = {
      nodeId: 'node-1',
      formatVersion: 1,
      generation: 3,
      binding: {
        sessionId: 'session-3',
        runtimeEpoch: 'epoch-3',
        route: { kind: 'local', workerInstanceId: 'worker-3' },
      },
      archivedEpochs: [
        {
          runtimeEpoch: 'epoch-1',
          cols: 40,
          rows: 4,
          bufferKind: 'normal',
          serializedScreen: 'FIRST_EPOCH_PROMPT',
        },
        {
          runtimeEpoch: 'epoch-2',
          cols: 40,
          rows: 4,
          bufferKind: 'alternate',
          serializedScreen: [
            '\u001b[?1049h\u001b[HSECOND_EPOCH_TUI',
            '\u001b[?1h',
            '\u001b[?66h',
            '\u001b[?2004h',
            '\u001b[4h',
            '\u001b[?6h',
            '\u001b[?45h',
            '\u001b[?1004h',
            '\u001b[?2026h',
            '\u001b[?7l',
            '\u001b[?9h',
            '\u001b[2;3r',
          ].join(''),
        },
      ],
      historyTruncated: false,
      checkpoint: {
        checkpointRevision: 1,
        appliedSeq: 1,
        presentationRevision: 1,
        cols: 40,
        rows: 4,
        geometryRevision: null,
        bufferKind: 'normal',
        cursor: { x: 18, y: 0 },
        title: 'shell',
        serializedScreen: 'THIRD_EPOCH_SHELL',
      },
      rawTail: 'THIRD_EPOCH_SHELL',
      rawTruncated: false,
      checksum: null,
      updatedAt: '2026-07-10T00:00:00.000Z',
    }
    const composed = composeTerminalRecoveryScrollback(record)
    const presentation = new TerminalPresentationSession({
      sessionId: 'recovered-session',
      cols: 40,
      rows: 4,
    })

    await presentation.applyOutput(1, composed)
    const snapshot = await presentation.snapshot()

    expect(snapshot.bufferKind).toBe('normal')
    expect(snapshot.serializedScreen).toContain('FIRST_EPOCH_PROMPT')
    expect(snapshot.serializedScreen).toContain('SECOND_EPOCH_TUI')
    expect(snapshot.serializedScreen).toContain('THIRD_EPOCH_SHELL')
    presentation.dispose()

    const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 4 })
    await new Promise<void>(resolve => terminal.write(composed, resolve))

    expect(terminal.buffer.active.type).toBe('normal')
    const internalBuffer = (
      terminal as unknown as {
        _core: { _bufferService: { buffer: { scrollTop: number; scrollBottom: number } } }
      }
    )._core._bufferService.buffer
    expect(internalBuffer.scrollTop).toBe(0)
    expect(internalBuffer.scrollBottom).toBe(3)
    expect(terminal.modes).toMatchObject({
      applicationCursorKeysMode: false,
      applicationKeypadMode: false,
      bracketedPasteMode: false,
      insertMode: false,
      mouseTrackingMode: 'none',
      originMode: false,
      reverseWraparoundMode: false,
      sendFocusMode: false,
      synchronizedOutputMode: false,
      wraparoundMode: true,
    })
    terminal.dispose()
  })
})
