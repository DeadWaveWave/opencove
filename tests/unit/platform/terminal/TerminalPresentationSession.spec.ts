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

  it('rejects stale geometry revisions and snapshots the accepted revision', async () => {
    const session = new TerminalPresentationSession({
      sessionId: 'session-revision',
      cols: 80,
      rows: 24,
    })

    expect(session.resize(120, 40, 2)).toEqual({
      cols: 120,
      rows: 40,
      changed: true,
      revision: 2,
    })
    expect(session.resize(90, 30, 1)).toEqual({
      cols: 120,
      rows: 40,
      changed: false,
      revision: 2,
    })

    const snapshot = await session.snapshot()

    expect(snapshot.cols).toBe(120)
    expect(snapshot.rows).toBe(40)
    expect(snapshot.geometryRevision).toBe(2)
  })

  it('owns canonical geometry revisions and rejects stale compare-and-set commits', () => {
    const session = new TerminalPresentationSession({
      sessionId: 'session-cas',
      cols: 80,
      rows: 24,
    })

    expect(
      session.commitGeometry({
        cols: 100,
        rows: 32,
        baseGeometryRevision: null,
      }),
    ).toEqual({
      status: 'accepted',
      changed: true,
      geometry: { cols: 100, rows: 32, revision: 1 },
    })

    expect(
      session.commitGeometry({
        cols: 120,
        rows: 40,
        baseGeometryRevision: null,
      }),
    ).toEqual({
      status: 'superseded',
      changed: false,
      geometry: { cols: 100, rows: 32, revision: 1 },
    })

    expect(
      session.commitGeometry({
        cols: 120,
        rows: 40,
        baseGeometryRevision: 1,
      }),
    ).toEqual({
      status: 'accepted',
      changed: true,
      geometry: { cols: 120, rows: 40, revision: 2 },
    })

    expect(
      session.commitGeometry({
        cols: 120,
        rows: 40,
        baseGeometryRevision: 2,
      }),
    ).toEqual({
      status: 'accepted',
      changed: false,
      geometry: { cols: 120, rows: 40, revision: 2 },
    })
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
