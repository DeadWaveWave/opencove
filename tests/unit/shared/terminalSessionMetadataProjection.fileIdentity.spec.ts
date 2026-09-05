import { expect, it } from 'vitest'
import type { TerminalSessionMetadataEvent } from '../../../src/shared/contracts/dto'
import { projectPtyStreamAgentMetadata } from '../../../src/shared/runtime/terminalSessionMetadataProjection'
import { TerminalAgentInvocationRegistry } from '../../../src/contexts/agent/application/TerminalAgentInvocationRegistry'

it('preserves a file-verified Codex identity through metadata replay until a new invocation', () => {
  const previous: TerminalSessionMetadataEvent = {
    sessionId: 'pty',
    resumeSessionId: 'owned',
    agentProvider: 'codex',
    terminalAgentActivity: {
      provider: 'codex',
      invocationId: 'one',
      generation: 1,
      phase: 'active',
      observedAtMs: 100,
      identityAuthority: 'session_file',
      sourceRevision: 2,
      revision: 2,
    },
  }
  expect(
    projectPtyStreamAgentMetadata(previous, {
      sessionId: 'pty',
      resumeSessionId: 'guess',
    }),
  ).toBeNull()
  expect(
    projectPtyStreamAgentMetadata(previous, {
      ...previous,
      resumeSessionId: 'replacement',
      terminalAgentActivity: { ...previous.terminalAgentActivity!, sourceRevision: 3, revision: 3 },
    })?.resumeSessionId,
  ).toBe('owned')
  expect(
    projectPtyStreamAgentMetadata(previous, {
      ...previous,
      resumeSessionId: null,
      terminalAgentActivity: {
        ...previous.terminalAgentActivity!,
        invocationId: 'two',
        generation: 2,
        identityAuthority: null,
        sourceRevision: 4,
        revision: 4,
      },
    })?.resumeSessionId,
  ).toBeNull()
})

it('keeps Codex file identity immutable while Pi alone can publish changing ordered snapshots', () => {
  const registry = new TerminalAgentInvocationRegistry()
  const terminal = registry.reserve({ sourceId: 'shim' })
  terminal.bind('pty')
  const codex = terminal.beginInvocation({ provider: 'codex', invocationId: 'codex' })!
  expect(codex.observe({ identityAuthority: 'session_file', resumeSessionId: 'owned' })).toBe(true)
  expect(codex.observe({ identityAuthority: 'session_file', resumeSessionId: 'other' })).toBe(false)
  expect(
    codex.observe({
      identityAuthority: 'provider_session_snapshot',
      sequence: 1,
      resumeSessionId: null,
    }),
  ).toBe(false)
  const pi = terminal.beginInvocation({ provider: 'pi', invocationId: 'pi' })!
  expect(codex.observe({ identityAuthority: 'session_file', resumeSessionId: 'owned' })).toBe(false)
  expect(pi.observe({ identityAuthority: 'session_file', resumeSessionId: 'guess' })).toBe(false)
  expect(
    pi.observe({
      identityAuthority: 'provider_session_snapshot',
      sequence: 1,
      resumeSessionId: '/pi.jsonl',
    }),
  ).toBe(true)
  expect(
    pi.observe({
      identityAuthority: 'provider_session_snapshot',
      sequence: 2,
      resumeSessionId: null,
    }),
  ).toBe(true)
  expect(registry.list().entries[0].resumeSessionId).toBeNull()
  terminal.release()
})
