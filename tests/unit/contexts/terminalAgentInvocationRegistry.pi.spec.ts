import { describe, expect, it } from 'vitest'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'

function setup(provider: 'pi' | 'codex' | 'claude-code' = 'pi') {
  const registry = new TerminalAgentInvocationRegistry()
  const terminal = registry.reserve({ sourceId: 'terminal-shim' })
  terminal.bind('pty')
  const invocation = terminal.beginInvocation({ provider, invocationId: 'launch' })!
  return { registry, terminal, invocation }
}

const identity = (sequence: number, resumeSessionId: string | null) => ({
  identityAuthority: 'provider_session_snapshot' as const,
  sequence,
  resumeSessionId,
})

describe('Pi invocation identity observations', () => {
  it('switches verified identities within one invocation and fences reordered observations', () => {
    const { registry, invocation } = setup()
    expect(invocation.observe(identity(1, '/sessions/a.jsonl'))).toBe(true)
    expect(invocation.observe(identity(3, '/sessions/b.jsonl'))).toBe(true)
    expect(invocation.observe(identity(2, '/sessions/a.jsonl'))).toBe(false)
    expect(registry.list().entries[0]).toMatchObject({
      resumeSessionId: '/sessions/b.jsonl',
      terminalAgentActivity: { generation: 1, identityAuthority: 'provider_session_snapshot' },
    })
    const revision = registry.list().revision
    expect(invocation.observe(identity(4, '/sessions/b.jsonl'))).toBe(true)
    expect(registry.list().revision).toBe(revision)
    expect(invocation.observe(identity(3, '/sessions/a.jsonl'))).toBe(false)
  })

  it('accepts explicit binding revocation but not observations after completion or replacement', () => {
    const { registry, terminal, invocation } = setup()
    invocation.observe(identity(1, '/sessions/a.jsonl'))
    expect(invocation.observe(identity(2, null))).toBe(true)
    expect(registry.list().entries[0]).toMatchObject({ resumeSessionId: null })
    terminal.complete({ generation: 1, invocationId: 'launch' })
    expect(invocation.observe(identity(3, '/sessions/a.jsonl'))).toBe(false)
    terminal.beginInvocation({ provider: 'pi', invocationId: 'replacement' })
    expect(invocation.observe(identity(100, '/sessions/old.jsonl'))).toBe(false)
  })

  it.each(['claude-code', 'codex'] as const)('does not loosen %s immutable identity', provider => {
    const { registry, invocation } = setup(provider)
    expect(invocation.observe(identity(1, '/pi.jsonl'))).toBe(false)
    expect(
      invocation.observe({ identityAuthority: 'provider_session_start', resumeSessionId: 'a' }),
    ).toBe(true)
    expect(
      invocation.observe({ identityAuthority: 'provider_session_start', resumeSessionId: 'b' }),
    ).toBe(false)
    expect(invocation.observe(identity(2, null))).toBe(false)
    expect(registry.list().entries[0].resumeSessionId).toBe('a')
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid sequence %s',
    sequence => {
      expect(setup().invocation.observe(identity(sequence, '/pi.jsonl'))).toBe(false)
    },
  )
})
