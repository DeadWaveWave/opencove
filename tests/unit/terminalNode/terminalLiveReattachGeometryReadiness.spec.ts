import {
  isLiveReattachFrameCommitted,
  type LiveTerminalFrame,
} from '../../e2e/workspace-canvas.terminal-live-reattach-geometry.helpers'

const small = { cols: 56, rows: 14 }
const measured = { cols: 99, rows: 30 }
const before: LiveTerminalFrame = {
  sessionId: 'live-pty',
  size: small,
  proposed: small,
  canonical: { ...small, revision: 1 },
  hydrated: true,
}
const committed: LiveTerminalFrame = {
  sessionId: before.sessionId,
  size: measured,
  proposed: measured,
  canonical: { ...measured, revision: 2 },
  hydrated: true,
}

describe('live terminal reattach completion', () => {
  it('rejects a matching local viewport before the Worker commits the measured frame', () => {
    const provisional = { ...committed, canonical: before.canonical }
    expect(isLiveReattachFrameCommitted(before, provisional)).toBe(false)
    // Ubuntu sampled the old grid in the next browser task after its provisional match.
    expect(isLiveReattachFrameCommitted(before, { ...provisional, size: small })).toBe(false)
    expect(isLiveReattachFrameCommitted(before, committed)).toBe(true)
  })

  it('waits for hydration even when the Worker and local dimensions already agree', () => {
    expect(isLiveReattachFrameCommitted(before, { ...committed, hydrated: false })).toBe(false)
  })

  it('requires a newer canonical revision rather than an unchanged baseline', () => {
    expect(
      isLiveReattachFrameCommitted(before, {
        ...committed,
        canonical: { ...measured, revision: 1 },
      }),
    ).toBe(false)
  })

  it('does not accept a replacement PTY or missing canonical geometry', () => {
    expect(
      isLiveReattachFrameCommitted(before, { ...committed, sessionId: 'replacement-pty' }),
    ).toBe(false)
    expect(isLiveReattachFrameCommitted(before, { ...committed, canonical: null })).toBe(false)
  })

  it('rejects the pre-reload match and incomplete measurements', () => {
    expect(isLiveReattachFrameCommitted(before, before)).toBe(false)
    expect(isLiveReattachFrameCommitted(before, { ...committed, proposed: null })).toBe(false)
    expect(isLiveReattachFrameCommitted(before, { ...committed, size: null })).toBe(false)
  })
})
