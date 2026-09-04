import { describe, expect, it } from 'vitest'
import {
  normalizeTerminalAgentActivitySnapshot,
  sameTerminalAgentActivitySnapshot,
} from '../../../src/shared/runtime/terminalAgentActivity'

const current = {
  provider: 'codex',
  invocationId: 'invocation-1',
  generation: 1,
  phase: 'active',
  observedAtMs: 1_000,
  identityAuthority: null,
} as const

describe('terminal Agent activity runtime normalization', () => {
  it('accepts both legacy and fully revisioned current snapshots', () => {
    expect(normalizeTerminalAgentActivitySnapshot(current)).toEqual(current)
    expect(
      normalizeTerminalAgentActivitySnapshot({
        ...current,
        sourceRevision: 4,
        revision: 9,
      }),
    ).toEqual({ ...current, sourceRevision: 4, revision: 9 })
  })

  it('rejects partial, zero, and unsafe revision fences', () => {
    expect(normalizeTerminalAgentActivitySnapshot({ ...current, sourceRevision: 1 })).toBeNull()
    expect(normalizeTerminalAgentActivitySnapshot({ ...current, revision: 1 })).toBeNull()
    expect(
      normalizeTerminalAgentActivitySnapshot({ ...current, sourceRevision: 0, revision: 1 }),
    ).toBeNull()
    expect(
      normalizeTerminalAgentActivitySnapshot({
        ...current,
        sourceRevision: 1,
        revision: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull()
  })

  it('includes revision fences in snapshot equality', () => {
    const revisioned = { ...current, sourceRevision: 1, revision: 1 }
    expect(sameTerminalAgentActivitySnapshot(revisioned, { ...revisioned })).toBe(true)
    expect(
      sameTerminalAgentActivitySnapshot(revisioned, { ...revisioned, sourceRevision: 2 }),
    ).toBe(false)
    expect(sameTerminalAgentActivitySnapshot(revisioned, { ...revisioned, revision: 2 })).toBe(
      false,
    )
  })
})
