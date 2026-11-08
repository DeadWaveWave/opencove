import { expect, it } from 'vitest'
import { continuationFixture, enqueue, dequeue, queued } from './claudeTurnContinuation.helpers'
import { PromptDeliveryRecords } from '../../../src/contexts/agent/application/PromptDeliveryRecords'
import type { RunStateFence } from '../../../src/contexts/agent/application/ports/PromptDeliveryPorts'

it('turn prompt identifiers: includes every retained continuation once, preserving legacy promptId', () => {
  const f = continuationFixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  f.record(dequeue)
  f.record(queued)
  const finalId = queued.kind === 'user' ? queued.promptId : ''
  f.hook('Stop', finalId, 'final')
  expect(f.read({ turnId: 't1' })).toMatchObject({ promptId: finalId, promptIds: ['A', finalId] })
  f.runtime.dispose()
})

it('turn delivery identifiers: joins only the exact session and turn, using content-free retained records', () => {
  const records = new PromptDeliveryRecords(() => 0)
  const fence = { snapshot: { sessionId: 's', nodeId: 'n', turn: { id: 't' } } } as RunStateFence
  const a = records.allocate('a', fence, 'steer')!
  records.settle(a, 'submitted')
  records.allocate('b', fence, 'steer')
  records.allocate(
    'other-turn',
    { ...fence, snapshot: { ...fence.snapshot, turn: { id: 'other' } } } as RunStateFence,
    'steer',
  )
  records.allocate(
    'other-session',
    { ...fence, snapshot: { ...fence.snapshot, sessionId: 'other' } },
    'steer',
  )
  expect(records.forTurn('s', 't')).toEqual(['a', 'b'])
})

it('turn identifiers: delivery enrichment also preserves metadata-only end errors', async () => {
  const { withTurnDeliveryIds } =
    await import('../../../src/contexts/agent/application/turnDeliveryIds')
  const { createAppError } = await import('../../../src/shared/errors/appError')
  const read = () => {
    throw createAppError('agent.final_message_unavailable', {
      details: {
        reason: 'provider_sent_no_message',
        sessionId: 's',
        turnId: 't',
        promptIds: ['A'],
        outcome: 'failed',
      },
    })
  }
  expect(() =>
    withTurnDeliveryIds(read, {
      forTurn: (session, turn) => {
        expect([session, turn]).toEqual(['s', 't'])
        return ['d']
      },
    }),
  ).toThrow(
    expect.objectContaining({
      details: expect.objectContaining({
        promptIds: ['A'],
        deliveryIds: ['d'],
        reason: 'provider_sent_no_message',
        outcome: 'failed',
      }),
    }),
  )
})

it('turn identifiers: exact message enrichment preserves legacy fields and does not widen the projection', async () => {
  const { withTurnDeliveryIds } =
    await import('../../../src/contexts/agent/application/turnDeliveryIds')
  expect(
    withTurnDeliveryIds(() => ({ sessionId: 's', turnId: 't', promptId: 'A', message: 'reply' }), {
      forTurn: (session, turn) => {
        expect([session, turn]).toEqual(['s', 't'])
        return ['d']
      },
    }),
  ).toEqual({ sessionId: 's', turnId: 't', promptId: 'A', message: 'reply', deliveryIds: ['d'] })
})
