import { describe, expect, it } from 'vitest'
import { SqliteTerminalRecoveryRepository } from '../../../src/contexts/terminal/infrastructure/recovery/SqliteTerminalRecoveryRepository'
import type { TerminalRuntimeBinding } from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'
import { recoveryChecksumWithoutReplayCursor } from '../../../src/contexts/terminal/infrastructure/recovery/terminalRecoveryChecksum'

type RecoveryRow = {
  node_id: string
  format_version: number
  generation: number
  binding_json: string | null
  runtime_epoch: string | null
  checkpoint_revision: number
  applied_seq: number
  presentation_json: string | null
  raw_tail: string
  raw_truncated: number
  checksum: string | null
  updated_at: string
}

class MemoryDatabase {
  public readonly nodeKinds = new Map<string, string>()
  public readonly recoveryRows = new Map<string, RecoveryRow>()
  public readonly scrollbacks = new Map<string, { scrollback: string; updated_at: string }>()

  public prepare(sql: string) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.startsWith('SELECT kind FROM nodes')) {
      return this.statement(nodeId => {
        const kind = this.nodeKinds.get(String(nodeId))
        return kind ? { kind } : undefined
      })
    }
    if (normalized.startsWith('SELECT node_id, format_version')) {
      return this.statement(nodeId => this.recoveryRows.get(String(nodeId)))
    }
    if (normalized.startsWith('SELECT scrollback, updated_at FROM node_scrollback')) {
      return this.statement(nodeId => this.scrollbacks.get(String(nodeId)))
    }
    if (normalized.startsWith('INSERT INTO terminal_recovery_records')) {
      return this.statement(undefined, (...params: unknown[]) => {
        const [
          nodeId,
          formatVersion,
          generation,
          bindingJson,
          runtimeEpoch,
          checkpointRevision,
          appliedSeq,
          presentationJson,
          rawTail,
          rawTruncated,
          checksum,
          updatedAt,
        ] = params
        this.recoveryRows.set(String(nodeId), {
          node_id: String(nodeId),
          format_version: Number(formatVersion),
          generation: Number(generation),
          binding_json: typeof bindingJson === 'string' ? bindingJson : null,
          runtime_epoch: typeof runtimeEpoch === 'string' ? runtimeEpoch : null,
          checkpoint_revision: Number(checkpointRevision),
          applied_seq: Number(appliedSeq),
          presentation_json: typeof presentationJson === 'string' ? presentationJson : null,
          raw_tail: String(rawTail),
          raw_truncated: Number(rawTruncated),
          checksum: typeof checksum === 'string' ? checksum : null,
          updated_at: String(updatedAt),
        })
      })
    }
    if (normalized.startsWith('INSERT INTO node_scrollback')) {
      return this.statement(undefined, (nodeId, scrollback, updatedAt) => {
        this.scrollbacks.set(String(nodeId), {
          scrollback: String(scrollback),
          updated_at: String(updatedAt),
        })
      })
    }
    throw new Error(`Unhandled SQL: ${normalized}`)
  }

  public transaction<TResult>(operation: () => TResult) {
    const execute = () => operation()
    execute.immediate = execute
    return execute
  }

  private statement(
    getResult?: ((...params: unknown[]) => unknown) | undefined,
    runEffect?: ((...params: unknown[]) => void) | undefined,
  ) {
    return {
      get: (...params: unknown[]) => getResult?.(...params),
      run: (...params: unknown[]) => runEffect?.(...params),
    }
  }
}

const NOW = '2026-07-10T00:00:00.000Z'

function binding(sessionId = 'session-1', runtimeEpoch = 'epoch-1'): TerminalRuntimeBinding {
  return {
    sessionId,
    runtimeEpoch,
    route: { kind: 'local', workerInstanceId: 'worker-1' },
  }
}

function checkpoint(revision: number) {
  return {
    appliedSeq: revision,
    presentationRevision: revision,
    cols: 80,
    rows: 24,
    geometryRevision: 1,
    bufferKind: 'normal' as const,
    cursor: { x: 1, y: 2 },
    title: 'shell',
    serializedScreen: `screen-${revision}`,
    checkpointRevision: revision,
  }
}

describe('SqliteTerminalRecoveryRepository', () => {
  it('promotes legacy scrollback into a generation reservation', async () => {
    const db = new MemoryDatabase()
    db.nodeKinds.set('node-1', 'terminal')
    db.scrollbacks.set('node-1', { scrollback: 'legacy raw', updated_at: NOW })
    const repository = new SqliteTerminalRecoveryRepository(db as never)

    await expect(repository.read('node-1')).resolves.toMatchObject({
      generation: 0,
      rawTail: 'legacy raw',
      checkpoint: null,
    })
    await expect(
      repository.reserve({ nodeId: 'node-1', generation: 1, now: NOW }),
    ).resolves.toMatchObject({
      ok: true,
      record: {
        generation: 1,
        rawTail: '',
        archivedEpochs: [{ runtimeEpoch: 'legacy:0', serializedScreen: 'legacy raw' }],
      },
    })
    expect(db.recoveryRows.get('node-1')).toMatchObject({
      generation: 1,
      raw_tail: '',
    })
    expect(db.scrollbacks.get('node-1')?.scrollback).toContain('legacy raw')
  })

  it('CAS-commits a checkpoint and mirrors its composed presentation atomically', async () => {
    const db = new MemoryDatabase()
    db.nodeKinds.set('node-1', 'terminal')
    const repository = new SqliteTerminalRecoveryRepository(db as never)
    await repository.reserve({ nodeId: 'node-1', generation: 1, now: NOW })
    await repository.bind({ nodeId: 'node-1', generation: 1, binding: binding(), now: NOW })

    await expect(
      repository.commit({
        nodeId: 'node-1',
        generation: 1,
        binding: binding(),
        checkpoint: checkpoint(1),
        rawTail: 'durable raw',
        rawTruncated: false,
        checksum: null,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      ok: true,
      record: { checksum: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
    expect(db.scrollbacks.get('node-1')?.scrollback).toBe('screen-1')
    await expect(repository.read('node-1')).resolves.toMatchObject({
      checkpoint: { checkpointRevision: 1, serializedScreen: 'screen-1' },
      rawTail: 'durable raw',
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    })

    await expect(
      repository.commit({
        nodeId: 'node-1',
        generation: 1,
        binding: binding(),
        checkpoint: checkpoint(1),
        rawTail: 'stale raw',
        rawTruncated: false,
        checksum: null,
        now: NOW,
      }),
    ).resolves.toEqual({ ok: false, reason: 'stale_checkpoint' })
    expect(db.scrollbacks.get('node-1')?.scrollback).toBe('screen-1')
  })

  it('persists archived presentations across three runtime epochs', async () => {
    const db = new MemoryDatabase()
    db.nodeKinds.set('node-1', 'terminal')
    const repository = new SqliteTerminalRecoveryRepository(db as never)

    await repository.reserve({ nodeId: 'node-1', generation: 1, now: NOW })
    await repository.bind({
      nodeId: 'node-1',
      generation: 1,
      binding: binding('session-1', 'epoch-1'),
      now: NOW,
    })
    await repository.commit({
      nodeId: 'node-1',
      generation: 1,
      binding: binding('session-1', 'epoch-1'),
      checkpoint: { ...checkpoint(1), serializedScreen: 'EPOCH_ONE' },
      rawTail: 'epoch one raw',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })

    await repository.reserve({ nodeId: 'node-1', generation: 2, now: NOW })
    await repository.bind({
      nodeId: 'node-1',
      generation: 2,
      binding: binding('session-2', 'epoch-2'),
      now: NOW,
    })
    await repository.commit({
      nodeId: 'node-1',
      generation: 2,
      binding: binding('session-2', 'epoch-2'),
      checkpoint: {
        ...checkpoint(1),
        bufferKind: 'alternate',
        serializedScreen: '\u001b[?1049h\u001b[HEPOCH_TWO_TUI',
      },
      rawTail: 'epoch two raw',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })

    await repository.reserve({ nodeId: 'node-1', generation: 3, now: NOW })
    await repository.bind({
      nodeId: 'node-1',
      generation: 3,
      binding: binding('session-3', 'epoch-3'),
      now: NOW,
    })
    await repository.commit({
      nodeId: 'node-1',
      generation: 3,
      binding: binding('session-3', 'epoch-3'),
      checkpoint: { ...checkpoint(1), serializedScreen: 'EPOCH_THREE' },
      rawTail: 'epoch three raw',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })

    await expect(repository.read('node-1')).resolves.toMatchObject({
      generation: 3,
      archivedEpochs: [
        { runtimeEpoch: 'epoch-1', serializedScreen: 'EPOCH_ONE' },
        { runtimeEpoch: 'epoch-2', serializedScreen: expect.stringContaining('EPOCH_TWO_TUI') },
      ],
      checkpoint: { checkpointRevision: 1, serializedScreen: 'EPOCH_THREE' },
    })
    const recovered = db.scrollbacks.get('node-1')?.scrollback ?? ''
    expect(recovered).toContain('EPOCH_ONE')
    expect(recovered).toContain('EPOCH_TWO_TUI')
    expect(recovered).toContain('EPOCH_THREE')
    expect(recovered.indexOf('EPOCH_ONE')).toBeLessThan(recovered.indexOf('EPOCH_TWO_TUI'))
    expect(recovered.indexOf('EPOCH_TWO_TUI')).toBeLessThan(recovered.indexOf('EPOCH_THREE'))
    expect(recovered.slice(recovered.indexOf('EPOCH_TWO_TUI'))).not.toContain('\u001b[?1049h')
  })

  it('accepts the archive-aware checksum written before replay cursors existed', async () => {
    const db = new MemoryDatabase()
    db.nodeKinds.set('node-1', 'terminal')
    const repository = new SqliteTerminalRecoveryRepository(db as never)
    await repository.reserve({ nodeId: 'node-1', generation: 1, now: NOW })
    await repository.bind({ nodeId: 'node-1', generation: 1, binding: binding(), now: NOW })
    const committed = await repository.commit({
      nodeId: 'node-1',
      generation: 1,
      binding: binding(),
      checkpoint: { ...checkpoint(1), downstreamReplayCursor: 7 },
      rawTail: 'legacy-checksum-raw',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })
    if (!committed.ok) {
      throw new Error('recovery commit failed')
    }

    const row = db.recoveryRows.get('node-1')
    const envelope = JSON.parse(row?.presentation_json ?? 'null') as Record<string, unknown> | null
    if (!row || !envelope) {
      throw new Error('recovery row missing')
    }
    delete envelope.downstreamReplayCursor
    row.presentation_json = JSON.stringify(envelope)
    row.checksum = recoveryChecksumWithoutReplayCursor(committed.record)

    await expect(repository.read('node-1')).resolves.toMatchObject({
      checkpoint: {
        serializedScreen: 'screen-1',
        downstreamReplayCursor: null,
      },
      checksum: row.checksum,
    })
  })

  it('rejects a replay cursor injected into a pre-cursor checksum envelope', async () => {
    const db = new MemoryDatabase()
    db.nodeKinds.set('node-1', 'terminal')
    const repository = new SqliteTerminalRecoveryRepository(db as never)
    await repository.reserve({ nodeId: 'node-1', generation: 1, now: NOW })
    await repository.bind({ nodeId: 'node-1', generation: 1, binding: binding(), now: NOW })
    const committed = await repository.commit({
      nodeId: 'node-1',
      generation: 1,
      binding: binding(),
      checkpoint: { ...checkpoint(1), downstreamReplayCursor: 7 },
      rawTail: 'cursor-integrity',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })
    if (!committed.ok) {
      throw new Error('recovery commit failed')
    }

    const row = db.recoveryRows.get('node-1')
    const envelope = JSON.parse(row?.presentation_json ?? 'null') as Record<string, unknown> | null
    if (!row || !envelope) {
      throw new Error('recovery row missing')
    }
    row.checksum = recoveryChecksumWithoutReplayCursor(committed.record)
    envelope.downstreamReplayCursor = 999
    row.presentation_json = JSON.stringify(envelope)

    await expect(repository.read('node-1')).resolves.toMatchObject({
      generation: 0,
      binding: null,
      checkpoint: null,
    })
  })

  it('rejects reservations for non-terminal nodes', async () => {
    const db = new MemoryDatabase()
    db.nodeKinds.set('node-1', 'agent')
    const repository = new SqliteTerminalRecoveryRepository(db as never)

    await expect(
      repository.reserve({ nodeId: 'node-1', generation: 1, now: NOW }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_node' })
    expect(db.recoveryRows.size).toBe(0)
  })
})
