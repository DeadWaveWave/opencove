import { describe, expect, it } from 'vitest'
import { TerminalPresentationSession } from '../../../../src/platform/terminal/presentation/TerminalPresentationSession'

describe('TerminalPresentationSession', () => {
  it('captures serialized screen, cursor, and resize state', async () => {
    const session = new TerminalPresentationSession({
      sessionId: 'session-1',
      cols: 10,
      rows: 5,
    })

    await session.applyOutput(1, 'hello\r\nworld')
    session.resize(12, 6)

    const snapshot = await session.snapshot()

    expect(snapshot.sessionId).toBe('session-1')
    expect(snapshot.appliedSeq).toBe(1)
    expect(snapshot.cols).toBe(12)
    expect(snapshot.rows).toBe(6)
    expect(snapshot.bufferKind).toBe('normal')
    expect(snapshot.cursor).toEqual({ x: 5, y: 1 })
    expect(snapshot.serializedScreen).toContain('hello\r\nworld')
  })

  it('tracks alternate buffer presentation and title updates', async () => {
    const session = new TerminalPresentationSession({
      sessionId: 'session-2',
      cols: 20,
      rows: 5,
    })

    await session.applyOutput(2, '\u001b]0;opencode\u0007\u001b[?1049hALT_SCREEN')

    const snapshot = await session.snapshot()

    expect(snapshot.appliedSeq).toBe(2)
    expect(snapshot.bufferKind).toBe('alternate')
    expect(snapshot.title).toBe('opencode')
    expect(snapshot.serializedScreen).toContain('ALT_SCREEN')
  })

  it('includes terminal modes in the authoritative snapshot contract', async () => {
    const session = new TerminalPresentationSession({
      sessionId: 'session-3',
      cols: 20,
      rows: 5,
    })

    await session.applyOutput(3, '\u001b[?1000h\u001b[?1006h\u001b[?2004hmouse modes ready')

    const snapshot = await session.snapshot()

    expect(snapshot.serializedScreen).toContain('\u001b[?1000h')
    expect(snapshot.serializedScreen).toContain('\u001b[?2004h')
  })
})
