import { describe, expect, it } from 'vitest'
import {
  normalizeTerminalAgentReexecInput,
  normalizeTerminalAgentReexecResult,
  terminalAgentActivityMatchesFence,
} from '../../../src/shared/runtime/terminalAgentReexec'

const input = {
  sessionId: 'session-1',
  operationId: 'operation-1',
  provider: 'codex',
  resumeSessionId: 'provider-session-1',
  expectedActivity: {
    provider: 'codex',
    invocationId: 'invocation-1',
    generation: 1,
    phase: 'active',
    observedAtMs: 1_000,
    sourceRevision: 2,
    revision: 3,
  },
  authorityEpoch: 4,
}

describe('terminal Agent re-exec wire validation', () => {
  it('normalizes the complete six-provider request contract', () => {
    expect(normalizeTerminalAgentReexecInput(input)).toEqual(input)
    expect(
      normalizeTerminalAgentReexecInput({ ...input, provider: 'pi', expectedActivity: null }),
    ).toMatchObject({ provider: 'pi', expectedActivity: null })
  })

  it.each([
    null,
    {},
    { ...input, provider: 'unknown' },
    { ...input, operationId: '' },
    { ...input, authorityEpoch: -1 },
    {
      ...input,
      expectedActivity: { ...input.expectedActivity, revision: undefined },
    },
    {
      ...input,
      expectedActivity: { ...input.expectedActivity, provider: 'claude-code' },
    },
  ])('rejects malformed or cross-provider input', value => {
    expect(normalizeTerminalAgentReexecInput(value)).toBeNull()
  })

  it('matches the complete invocation fence and parses only typed results', () => {
    const current = {
      ...input.expectedActivity,
      identityAuthority: 'provider_session_start' as const,
    }
    expect(terminalAgentActivityMatchesFence(current, input.expectedActivity)).toBe(true)
    expect(
      terminalAgentActivityMatchesFence(
        { ...current, generation: current.generation + 1 },
        input.expectedActivity,
      ),
    ).toBe(false)
    expect(
      normalizeTerminalAgentReexecResult({
        sessionId: 'session-1',
        operationId: 'operation-1',
        status: 'reexecuted',
      }),
    ).toEqual({ sessionId: 'session-1', operationId: 'operation-1', status: 'reexecuted' })
    expect(
      normalizeTerminalAgentReexecResult({
        sessionId: 'session-1',
        operationId: 'operation-1',
        status: 'accepted',
      }),
    ).toBeNull()
  })
})
