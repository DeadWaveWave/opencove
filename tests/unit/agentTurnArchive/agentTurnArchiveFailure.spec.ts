// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createAgentTurnArchive,
  type AgentTurnArchiveStorage,
} from '../../../src/contexts/agent/application/createAgentTurnArchive'
import { AGENT_TURN_ARCHIVE_LIMITS as limits } from '../../../src/contexts/agent/application/AgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'
import { InMemoryAgentTurnArchive } from '../../support/agentTurnArchive/InMemoryAgentTurnArchive'

function storage(overrides: Partial<AgentTurnArchiveStorage> = {}): AgentTurnArchiveStorage {
  return {
    append: vi.fn(() => 'persisted' as const),
    captureWatermark: vi.fn(() => 0),
    checkpoint: vi.fn(),
    getExact: vi.fn(),
    getExactBySession: vi.fn(),
    clearNode: vi.fn(() => 0),
    revokeNodes: vi.fn(),
    sweep: vi.fn(() => false),
    dispose: vi.fn(),
    ...overrides,
  }
}

describe('ended-turn archive failure isolation', () => {
  it('never exposes storage exceptions, and disables the failing adapter', () => {
    const fail = () => {
      throw new Error('private contents must not escape')
    }
    const db = storage({ append: fail, dispose: fail })
    const archive = createAgentTurnArchive(db, Date.now, () => 'member')
    expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'write_failed' })
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'unavailable' })
    expect(() => archive.sweep(100)).not.toThrow()
    expect(() => archive.revokeNodes(['node'])).not.toThrow()
    expect(() => archive.dispose()).not.toThrow()
  })

  it.each(['getExact', 'getExactBySession', 'revokeNodes', 'sweep'] as const)(
    'fails closed on %s failure',
    method => {
      const db = storage({
        [method]: () => {
          throw new Error('failure')
        },
      })
      const archive = createAgentTurnArchive(db, Date.now, () => 'member')
      expect(() => {
        if (method === 'revokeNodes') {
          archive.revokeNodes(['other'])
        } else if (method === 'sweep') {
          archive.sweep(100)
        } else {
          archive[method]({ nodeId: 'node', turnId: 'turn', sessionId: 'session' })
        }
      }).not.toThrow()
      expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
      expect(db.dispose).toHaveBeenCalled()
    },
  )

  it('bounds revocation without forgetting deletion authority', () => {
    const archive = new InMemoryAgentTurnArchive()
    archive.revokeNodes(Array.from({ length: limits.revokedNodes + 1 }, (_, i) => `node-${i}`))
    expect(archive.append(endedTurn({ nodeId: 'node-0' }))).toEqual({
      status: 'memory_only',
      reason: 'deleted',
    })
    expect(archive.append(endedTurn({ nodeId: 'unseen-node' }))).toEqual({
      status: 'memory_only',
      reason: 'unavailable',
    })
  })

  it('returns detached records and rejects reentrant storage operations', () => {
    let nested: unknown
    const db = storage({
      append: () => {
        nested = archive.append(endedTurn())
        return 'persisted' as const
      },
    })
    const archive = createAgentTurnArchive(db, Date.now, () => 'member')
    expect(archive.append(endedTurn())).toEqual({ status: 'persisted' })
    expect(nested).toEqual({ status: 'memory_only', reason: 'unavailable' })
    const fake = new InMemoryAgentTurnArchive()
    fake.append(endedTurn())
    const result = fake.getExact({ nodeId: 'node', turnId: 'turn' })
    if (result.status === 'found') {
      result.record.message = 'changed'
    }
    expect(fake.getExact({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
      status: 'found',
      record: { message: 'reply' },
    })
    fake.dispose()
  })
})

it.each(['SQLITE_CORRUPT', 'SQLITE_NOTADB'])(
  'disables archive reads on %s during SQL use',
  code => {
    const db = storage({
      getExact: () => {
        throw Object.assign(new Error('private data'), { code })
      },
    })
    const archive = createAgentTurnArchive(db, Date.now, () => 'member')
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'unavailable' })
    expect(db.dispose).toHaveBeenCalledOnce()
    expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
  },
)
