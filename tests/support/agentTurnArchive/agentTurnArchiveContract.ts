import { expect, it } from 'vitest'
import type {
  AgentTurnArchive,
  AgentTurnArchiveInput,
} from '../../../src/contexts/agent/application/AgentTurnArchive'

export function endedTurn(overrides: Partial<AgentTurnArchiveInput> = {}): AgentTurnArchiveInput {
  return {
    nodeId: 'node',
    turnId: 'turn',
    sessionId: 'original-session',
    provider: 'claude-code',
    providerSessionId: null,
    promptId: null,
    outcome: 'completed',
    endedAt: 1,
    message: 'reply',
    truncated: false,
    superseded: false,
    ...overrides,
  }
}

export function agentTurnArchiveContract(
  create: (options: { now: () => number }) => AgentTurnArchive,
) {
  it('preserves immutable identity, empty replies and metadata-only ends', () => {
    let now = 100
    const archive = create({ now: () => now })
    try {
      expect(archive.append(endedTurn())).toEqual({ status: 'persisted' })
      const first = archive.getExact({ nodeId: 'node', turnId: 'turn' })
      now++
      expect(
        archive.append(endedTurn({ message: 'replacement', sessionId: 'replacement' })),
      ).toEqual({ status: 'persisted' })
      expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual(first)
      expect(archive.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual(
        first,
      )
      expect(archive.getExactBySession({ sessionId: 'replacement', turnId: 'turn' })).toEqual({
        status: 'absent',
      })
      for (const message of [null, '']) {
        archive.append(endedTurn({ turnId: String(message), message }))
        expect(archive.getExact({ nodeId: 'node', turnId: String(message) })).toMatchObject({
          status: 'found',
          record: { message, messageBytes: 0 },
        })
      }
    } finally {
      archive.dispose()
    }
  })

  it('retains sixty whole records per node by insertion order, including metadata', () => {
    const archive = create({ now: () => 100 })
    try {
      for (let i = 0; i < 61; i++) {
        archive.append(endedTurn({ turnId: String(i), endedAt: 100 - i, message: null }))
      }
      expect(archive.getExact({ nodeId: 'node', turnId: '0' })).toEqual({ status: 'absent' })
      expect(archive.getExact({ nodeId: 'node', turnId: '1' })).toMatchObject({ status: 'found' })
      expect(archive.getExact({ nodeId: 'node', turnId: '60' })).toMatchObject({ status: 'found' })
    } finally {
      archive.dispose()
    }
  })

  it('clears only the selected node across sessions, counts metadata, and permits later appends', () => {
    const archive = create({ now: () => 100 })
    try {
      archive.append(endedTurn())
      archive.append(endedTurn({ turnId: 'metadata', sessionId: 'older', message: null }))
      archive.append(endedTurn({ nodeId: 'other' }))
      expect(archive.clearNode('node')).toEqual({ status: 'cleared', removed: 2 })
      expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' })
      expect(archive.getExactBySession({ sessionId: 'older', turnId: 'metadata' })).toEqual({
        status: 'absent',
      })
      expect(archive.getExact({ nodeId: 'other', turnId: 'turn' })).toMatchObject({
        status: 'found',
      })
      expect(archive.clearNode('node')).toEqual({ status: 'cleared', removed: 0 })
      expect(archive.append(endedTurn({ turnId: 'later' }))).toEqual({ status: 'persisted' })
      expect(archive.getExact({ nodeId: 'node', turnId: 'later' })).toMatchObject({
        status: 'found',
      })
    } finally {
      archive.dispose()
    }
  })

  it('caps UTF-8 messages without splitting code points', () => {
    const archive = create({ now: () => 100 })
    try {
      archive.append(endedTurn({ message: 'a' + '😀'.repeat(17000) }))
      const result = archive.getExact({ nodeId: 'node', turnId: 'turn' })
      expect(result).toMatchObject({
        status: 'found',
        record: { truncated: true, messageBytes: 65533 },
      })
      if (result.status === 'found') {
        expect(result.record.message?.isWellFormed()).toBe(true)
      }
    } finally {
      archive.dispose()
    }
  })

  it('revokes both selectors and refuses late appends, while classifying excluded ownership', () => {
    const archive = create({ now: () => 100 })
    try {
      expect(archive.append(endedTurn({ nodeId: null }))).toEqual({
        status: 'memory_only',
        reason: 'unbound',
      })
      expect(archive.append(endedTurn({ remote: true }))).toEqual({
        status: 'memory_only',
        reason: 'remote',
      })
      archive.append(endedTurn())
      archive.revokeNodes(['node'])
      expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' })
      expect(archive.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual({
        status: 'absent',
      })
      expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'deleted' })
    } finally {
      archive.dispose()
    }
  })

  it('sweeps orphan rows in bounded batches without deleting surviving nodes', () => {
    const archive = create({ now: () => 100 })
    try {
      for (let i = 0; i < 266; i++) {
        archive.append(endedTurn({ nodeId: `node-${i}` }))
      }
      const existing = new Set(['node-0'])
      archive.sweep(100, existing)
      expect(archive.getExact({ nodeId: 'node-0', turnId: 'turn' })).toMatchObject({
        status: 'found',
      })
      expect(archive.getExact({ nodeId: 'node-1', turnId: 'turn' })).toEqual({ status: 'absent' })
      expect(archive.getExact({ nodeId: 'node-265', turnId: 'turn' })).toMatchObject({
        status: 'found',
      })
      archive.sweep(100, existing)
      expect(archive.getExact({ nodeId: 'node-265', turnId: 'turn' })).toEqual({ status: 'absent' })
    } finally {
      archive.dispose()
    }
  })

  it('expires by archival time rather than observation time and closes idempotently', () => {
    let now = 100
    const archive = create({ now: () => now })
    archive.append(endedTurn({ endedAt: -1e12 }))
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toMatchObject({ status: 'found' })
    now += 30 * 24 * 60 * 60 * 1000 + 1
    archive.sweep(now)
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' })
    archive.dispose()
    archive.dispose()
    expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'unavailable' })
  })
}
