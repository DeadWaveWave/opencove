// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  planArchiveEviction,
  createAgentTurnArchive,
  type AgentTurnArchiveStorage,
} from '../../../src/contexts/agent/application/createAgentTurnArchive'
import { AGENT_TURN_ARCHIVE_LIMITS as limits } from '../../../src/contexts/agent/application/AgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'

it('refuses the mixed-record purge before insert when more than 64 evictions are needed', () => {
  const oldest = Array.from({ length: 65 }, (_, i) => ({ seq: i + 1, messageBytes: 0 }))
  expect(
    planArchiveEviction({ records: 20_000, bytes: limits.messageBytes }, 65536, [], oldest),
  ).toBeNull()
  expect(
    planArchiveEviction(
      { records: 20_000, bytes: limits.messageBytes },
      65536,
      [],
      [{ seq: 1, messageBytes: 65536 }],
    ),
  ).toEqual([1])
})

it('returns a typed retention backlog without disabling the port or acknowledging an insert', () => {
  const append = vi.fn().mockReturnValueOnce('retention_backlog').mockReturnValue('persisted')
  const dispose = vi.fn()
  const storage = { append, dispose } as unknown as AgentTurnArchiveStorage
  const archive = createAgentTurnArchive(storage)
  expect(archive.append(endedTurn())).toEqual({
    status: 'memory_only',
    reason: 'retention_backlog',
  })
  expect(dispose).not.toHaveBeenCalled()
  expect(archive.append(endedTurn())).toEqual({ status: 'persisted' })
})
