// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  continuationFixture,
  enqueue,
  dequeue,
  queued,
} from '../contexts/claudeTurnContinuation.helpers'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'
import { AgentRunStateRegistry } from '../../../src/contexts/agent/application/AgentRunStateRegistry'

it('archives one OpenCove turn with the final reply across queued provider segments', () => {
  const archive = new InMemoryAgentTurnArchive(),
    append = vi.spyOn(archive, 'append')
  const f = continuationFixture(archive)
  f.hook('UserPromptSubmit', 'A')
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'intermediate')
  expect(append).not.toHaveBeenCalled()
  f.record(dequeue)
  f.record(queued)
  f.hook('Stop', queued.kind === 'user' ? queued.promptId : '', 'final reply')
  expect(append).toHaveBeenCalledOnce()
  expect(append).toHaveBeenCalledWith(
    expect.objectContaining({
      nodeId: 'n',
      turnId: 't1',
      message: 'final reply',
      outcome: 'completed',
    }),
  )
  expect(f.read({ turnId: 't1' })).toMatchObject({ persisted: true, message: 'final reply' })
  f.runtime.dispose()
})

it('persists an uncertain continuation as unknown/intermediate without upgrading its end later', () => {
  const archive = new InMemoryAgentTurnArchive(),
    append = vi.spyOn(archive, 'append')
  const f = continuationFixture(archive)
  f.hook('UserPromptSubmit', 'A')
  f.hook('UserPromptSubmit', 'A')
  f.hook('Stop', 'A', 'intermediate')
  f.tick(30_000)
  expect(append).toHaveBeenCalledOnce()
  expect(append).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: 'unknown',
      messageKind: 'intermediate',
      message: 'intermediate',
    }),
  )
  const restarted = new AgentRunStateRegistry({
    archive,
    membership: () => 'member',
    epoch: 'new',
    now: Date.now,
    createTurnId: () => 'unused',
    schedule: () => () => {},
  })
  expect(restarted.finalMessage({ nodeId: 'n', turnId: 't1' })).toMatchObject({
    persisted: true,
    outcome: 'unknown',
    messageKind: 'intermediate',
  })
  f.runtime.dispose()
  restarted.dispose()
})
