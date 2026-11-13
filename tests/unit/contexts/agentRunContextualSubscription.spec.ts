import { expect, it } from 'vitest'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'
it('exposes retained previous/current bindings before type filtering and classifies gaps', () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
  })
  registry.register({
    sessionId: 's',
    nodeId: 'child',
    provider: 'codex',
    incarnation: 'i',
    projectId: 'p',
    spaceId: 'main',
  })
  const start = registry.watermark()
  registry.bind('s', { nodeId: null })
  const events: unknown[] = []
  registry.subscribeContextual({ epoch: 'e', afterSeq: start.seq }, e => events.push(e))
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    previousBinding: { nodeId: 'child', spaceId: 'main' },
    event: { snapshot: { nodeId: null } },
  })
  const gaps: unknown[] = []
  registry.subscribeContextual({ epoch: 'old', afterSeq: 0 }, e => gaps.push(e))
  expect(gaps).toEqual([
    expect.objectContaining({ type: 'resync_required', reason: 'epoch_changed' }),
  ])
})
it('classifies ahead and expired cursors and keeps reentrant publications ordered', () => {
  const registry = new AgentRunStateRegistry({
    epoch: 'e',
    now: () => 1,
    createTurnId: () => 't',
    schedule: () => () => {},
    retention: 2,
  })
  const register = (sessionId: string) =>
    registry.register({ sessionId, nodeId: sessionId, provider: 'codex', incarnation: sessionId })
  register('one')
  register('two')
  const seq: number[] = []
  registry.subscribeContextual({ epoch: 'e', afterSeq: 0 }, publication => {
    if ('event' in publication) {
      seq.push(publication.event.seq)
      if (publication.event.seq === 1) {
        register('three')
      }
    }
  })
  expect(seq).toEqual([1, 2, 3])
  const errors: unknown[] = []
  registry.subscribeContextual({ epoch: 'e', afterSeq: 9 }, e => errors.push(e))
  registry.subscribeContextual({ epoch: 'e', afterSeq: 0 }, e => errors.push(e))
  expect(errors).toEqual([
    expect.objectContaining({ reason: 'cursor_ahead' }),
    expect.objectContaining({ reason: 'retention_expired' }),
  ])
})
