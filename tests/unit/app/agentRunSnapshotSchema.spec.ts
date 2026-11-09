import { expect, it } from 'vitest'
import {
  agentRunSnapshotSchema,
  agentRunEventSchema,
  agentRuntimeFrameSchema,
} from '../../../src/shared/contracts/dto/agentRunStateSchema'
import { normalizeBrowserPtyStateMetadata } from '../../../src/app/renderer/browser/BrowserPtyWire'
import { snapshot } from './cliAgentWait.helpers'

const lastEndedTurn = { id: 'turn-a', outcome: 'failed' as const, endedAt: 20 }
const current = { ...snapshot(), lastEndedTurn, blockedSummary: null }
it('defaults missing lastEndedTurn to null for older Worker snapshots and events', () => {
  const { lastEndedTurn: _absent, ...legacy } = current
  expect(agentRunSnapshotSchema.parse(legacy).lastEndedTurn).toBeNull()
  expect(
    agentRunEventSchema.parse({ type: 'agent.state_changed', epoch: 'e', seq: 1, snapshot: legacy })
      .snapshot.lastEndedTurn,
  ).toBeNull()
})
it('keeps snapshot/event/frame parsing additive for older CLI and remote consumers', () => {
  const additive = { ...current, futureField: 'accepted' }
  // The pre-feature snapshot schema used the same non-strict object behavior.
  const olderCliSchema = agentRunSnapshotSchema.omit({ lastEndedTurn: true })
  expect(olderCliSchema.parse(additive)).not.toHaveProperty('lastEndedTurn')
  expect(agentRunSnapshotSchema.parse(additive)).toEqual(current)
  const event = {
    type: 'agent.turn_completed',
    epoch: 'e',
    seq: 2,
    snapshot: additive,
    endedTurn: { id: 'turn-a', startedAt: 1, start: 'observed' },
    futureEventField: true,
  }
  expect(agentRunEventSchema.parse(event).snapshot.lastEndedTurn).toEqual(lastEndedTurn)
  expect(
    agentRuntimeFrameSchema.parse({ type: 'agent.event', event, futureFrameField: true }),
  ).toMatchObject({ event: { snapshot: { lastEndedTurn } } })
  expect(
    agentRuntimeFrameSchema.parse({
      type: 'agent.baseline',
      epoch: 'e',
      seq: 2,
      agents: [additive],
    }),
  ).toMatchObject({ agents: [{ lastEndedTurn }] })
})
it('preserves the additive field in the Web UI wire parser', () => {
  expect(normalizeBrowserPtyStateMetadata({ agentRunState: current }).agentRunState).toEqual(
    current,
  )
})
it.each([
  { ...lastEndedTurn, endedAt: Infinity },
  { ...lastEndedTurn, outcome: 'success' },
  { ...lastEndedTurn, id: '' },
])('rejects malformed end identity %j', invalidEnd => {
  expect(agentRunSnapshotSchema.safeParse({ ...current, lastEndedTurn: invalidEnd }).success).toBe(
    false,
  )
})
it('serializes bounded question and plan data across snapshot and event contracts', () => {
  const question = agentRunSnapshotSchema.parse({
    ...current,
    state: 'waiting',
    blockedReason: 'question',
    blockedSummary: {
      kind: 'question',
      questions: [{ question: 'Which?', options: ['One', 'Two'] }],
    },
  })
  const plan = agentRunEventSchema.parse({
    type: 'agent.state_changed',
    epoch: 'e',
    seq: 1,
    snapshot: { ...question, blockedReason: 'plan', blockedSummary: { kind: 'plan' } },
  })
  expect({ question, plan }).toMatchSnapshot()
})
