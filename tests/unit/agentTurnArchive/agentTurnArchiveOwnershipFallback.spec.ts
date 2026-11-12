// @vitest-environment node
import { expect, it } from 'vitest'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
import type { PromptSubmissionEvidence } from '../../../src/shared/runtime/agentHook/claudePromptEvidence'

function fixture(archive?: InMemoryAgentTurnArchive) {
  let time = 0,
    sequence = 0,
    turn = 0
  const registry = new AgentRunStateRegistry({
    archive,
    membership: archive ? () => 'member' : undefined,
    epoch: 'e',
    now: () => time,
    createTurnId: () => `t${++turn}`,
    schedule: () => () => {},
  })
  registry.register({ sessionId: 's', provider: 'claude-code', incarnation: 'i' })
  const hook = (promptId: string, end = false, message = 'reply') => {
    const evidence: PromptSubmissionEvidence = {
      providerSessionId: 'provider',
      promptId,
      ...(end ? { finalMessage: { message, truncated: false } } : {}),
    }
    registry.observe(
      's',
      {
        incarnation: 'i',
        source: 'claude_hook',
        sourceSequence: ++sequence,
        observedAt: ++time,
        emittedAtMs: time,
        hookEventName: end ? 'Stop' : 'UserPromptSubmit',
        state: end ? 'idle' : 'working',
        boundary: end
          ? { kind: 'end', outcome: 'completed' }
          : { kind: 'start', evidence: 'prompt_submit' },
      },
      evidence,
    )
  }
  return { registry, hook }
}

it.each([true, false])(
  'resolves active exact reads with launch ownership before binding (launch=%s)',
  launch => {
    const { registry, hook } = fixture()
    if (launch) {
      registry.captureLaunchIdentity('s', 'launch-owner')
    }
    registry.bind('s', { nodeId: 'launch-owner' })
    hook('p')
    registry.bind('s', { nodeId: 'binding-owner' })
    const owner = launch ? 'launch-owner' : 'binding-owner'
    const other = launch ? 'binding-owner' : 'launch-owner'
    expect(() => registry.finalMessage({ nodeId: owner, turnId: 't1' })).toThrow(
      expect.objectContaining({ details: { reason: 'turn_not_ended' } }),
    )
    expect(() => registry.finalMessage({ nodeId: other, turnId: 't1' })).toThrow(
      expect.objectContaining({ details: { reason: 'turn_not_found' } }),
    )
    registry.dispose()
  },
)

it('captures the end-time binding without spawn identity and never relabels it after rebinding', () => {
  const { registry, hook } = fixture()
  registry.bind('s', { nodeId: 'end-owner' })
  hook('p')
  hook('p', true)
  expect(registry.finalMessage({ nodeId: 'end-owner', turnId: 't1' })).toMatchObject({
    nodeId: 'end-owner',
    sessionId: 's',
    message: 'reply',
    persisted: false,
    memoryOnlyReason: 'unavailable',
  })
  registry.bind('s', { nodeId: 'later-owner' })
  expect(registry.finalMessage({ sessionId: 's', turnId: 't1' })).toMatchObject({
    nodeId: 'end-owner',
  })
  expect(registry.finalMessage({ nodeId: 'end-owner', turnId: 't1' })).toMatchObject({
    nodeId: 'end-owner',
  })
  expect(() => registry.finalMessage({ nodeId: 'later-owner', turnId: 't1' })).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_found' } }),
  )
  registry.dispose()
})

it('uses the binding at the end rather than the start when no immutable launch identity exists', () => {
  const { registry, hook } = fixture()
  registry.bind('s', { nodeId: 'start-owner' })
  hook('p')
  registry.bind('s', { nodeId: 'end-owner' })
  hook('p', true)
  expect(registry.finalMessage({ nodeId: 'end-owner', turnId: 't1' })).toMatchObject({
    nodeId: 'end-owner',
    message: 'reply',
  })
  registry.dispose()
})

it('preserves the eight-end prompt selector window while exact turn retention grows', () => {
  const { registry, hook } = fixture()
  registry.captureLaunchIdentity('s', 'node')
  registry.bind('s', { nodeId: 'node' })
  for (let i = 0; i < 9; i++) {
    hook(`p${i}`)
    hook(`p${i}`, true)
  }
  expect(registry.finalMessage({ nodeId: 'node', turnId: 't1' })).toMatchObject({
    message: 'reply',
  })
  expect(() => registry.finalMessage({ nodeId: 'node', promptId: 'p0' })).toThrow(
    expect.objectContaining({ details: { reason: 'turn_not_found' } }),
  )
  expect(registry.finalMessage({ nodeId: 'node', promptId: 'p1' })).toMatchObject({ turnId: 't2' })
  registry.dispose()
})

it('archives the captured binding fallback for exact reads after a registry restart', () => {
  const archive = new InMemoryAgentTurnArchive({ now: () => 100 })
  const { registry, hook } = fixture(archive)
  registry.bind('s', { nodeId: 'node' })
  hook('p')
  hook('p', true)
  expect(archive.getExact({ nodeId: 'node', turnId: 't1' })).toMatchObject({
    status: 'found',
    record: { nodeId: 'node', sessionId: 's' },
  })
  registry.dispose()
  const fresh = fixture(archive).registry
  expect(fresh.finalMessage({ nodeId: 'node', turnId: 't1' })).toMatchObject({
    nodeId: 'node',
    sessionId: 's',
    persisted: true,
    message: 'reply',
  })
  fresh.dispose()
  archive.dispose()
})
