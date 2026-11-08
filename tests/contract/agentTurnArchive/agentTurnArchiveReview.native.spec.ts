// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createSqliteAgentTurnArchive } from '../../../src/contexts/agent/infrastructure/turnArchive/createSqliteAgentTurnArchive'
import { AGENT_TURN_ARCHIVE_FILE } from '../../../src/contexts/agent/infrastructure/turnArchive/archiveSchema'
import type {
  AgentTurnArchive,
  ArchiveMembership,
} from '../../../src/contexts/agent/application/AgentTurnArchive'
import { endedTurn } from '../../support/agentTurnArchive/agentTurnArchiveContract'

describeWithElectronNativeModules('ended-turn archive review fixes', () => {
  const roots: string[] = []
  const archives: AgentTurnArchive[] = []
  const dbs: Database.Database[] = []
  function root() {
    const dir = mkdtempSync(join(tmpdir(), 'opencove-archive-review-'))
    roots.push(dir)
    return dir
  }
  function open(dir: string, membership: ArchiveMembership = () => 'member') {
    const archive = createSqliteAgentTurnArchive({ userDataPath: dir, now: () => 100, membership })
    archives.push(archive)
    return archive
  }
  function connect(dir: string) {
    const db = new Database(join(dir, AGENT_TURN_ARCHIVE_FILE))
    dbs.push(db)
    return db
  }
  afterEach(() => {
    archives.splice(0).forEach(archive => archive.dispose())
    dbs.splice(0).forEach(db => {
      if (db.open) {
        db.close()
      }
    })
    roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
    vi.restoreAllMocks()
  })

  it('preserves concurrent appends above the captured orphan watermark', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn({ nodeId: 'old' }))
    const through = archive.captureWatermark()!
    archive.append(endedTurn({ nodeId: 'new' }))
    archive.sweep(100, new Set(['old']), through)
    expect(archive.getExact({ nodeId: 'new', turnId: 'turn' })).toMatchObject({ status: 'found' })
  })

  it('hides crash-surviving deleted rows on reopen before bounded cleanup reaches them', () => {
    const dir = root()
    const archive = open(dir)
    const survivors = new Set(Array.from({ length: 256 }, (_, i) => `n${i}`))
    for (const nodeId of [...survivors, 'deleted']) {
      archive.append(endedTurn({ nodeId, sessionId: nodeId }))
    }
    // Simulate a crash between the workspace deletion and archive revocation.
    archive.dispose()
    let known = false
    const reopened = open(dir, id =>
      !known ? 'unknown' : id === undefined || survivors.has(id) ? 'member' : 'absent',
    )
    expect(reopened.getExact({ nodeId: 'deleted', turnId: 'turn' })).toEqual({
      status: 'unavailable',
    })
    known = true
    expect(reopened.sweep(100, survivors)).toEqual({ status: 'more' })
    expect(reopened.getExact({ nodeId: 'deleted', turnId: 'turn' })).toEqual({ status: 'absent' })
    expect(reopened.getExactBySession({ sessionId: 'deleted', turnId: 'turn' })).toEqual({
      status: 'absent',
    })
    expect(reopened.sweep(100, survivors)).toEqual({ status: 'complete' })
    expect(
      connect(dir).prepare("SELECT 1 FROM ended_turns WHERE node_id = 'deleted'").get(),
    ).toBeUndefined()
  })

  it('does not expose rows after failed revocation and restart', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn())
    const locker = connect(dir)
    locker.exec('BEGIN IMMEDIATE')
    archive.revokeNodes(['node'])
    locker.exec('ROLLBACK')
    const reopened = open(dir, () => 'absent')
    expect(reopened.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'absent' })
    expect(reopened.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual({
      status: 'absent',
    })
  })

  it('deletes durable rows before disabling on revocation overflow', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn({ nodeId: 'n20000' }))
    archive.revokeNodes(Array.from({ length: 20_001 }, (_, i) => `n${i}`))
    expect(connect(dir).prepare('SELECT COUNT(*) AS n FROM ended_turns').get()).toEqual({ n: 0 })
  })

  it.each([
    'UPDATE archive_schema SET next_seq = 1',
    'UPDATE archive_schema SET record_count = 0',
    'UPDATE archive_schema SET message_bytes = 0',
    'PRAGMA ignore_check_constraints = ON; UPDATE archive_schema SET id = 2',
    'DELETE FROM archive_schema',
  ])('disables inconsistent bookkeeping without repairing the file: %s', sql => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn())
    archive.dispose()
    const db = connect(dir)
    db.exec(sql)
    db.close()
    const path = join(dir, AGENT_TURN_ARCHIVE_FILE)
    const before = readFileSync(path)
    const reopened = open(dir)
    expect(reopened.append(endedTurn({ turnId: 'new' }))).toEqual({
      status: 'memory_only',
      reason: 'unavailable',
    })
    reopened.dispose()
    expect(readFileSync(path)).toEqual(before)
  })

  it('reports sequence collisions and CHECK violations rather than successful duplicates', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn())
    const db = connect(dir)
    db.exec('UPDATE archive_schema SET next_seq = 1')
    expect(archive.append(endedTurn({ turnId: 'new' }))).toEqual({
      status: 'memory_only',
      reason: 'write_failed',
    })
    expect(db.prepare("SELECT 1 FROM ended_turns WHERE turn_id = 'new'").get()).toBeUndefined()
    db.exec('UPDATE archive_schema SET next_seq = 2')
    const reopened = open(dir)
    expect(reopened.append(endedTurn({ turnId: 'invalid', outcome: 'invalid' as never }))).toEqual({
      status: 'memory_only',
      reason: 'write_failed',
    })
    expect(db.prepare('SELECT record_count, next_seq FROM archive_schema').get()).toEqual({
      record_count: 1,
      next_seq: 2,
    })
  })

  it('refuses the mixed-record synchronous purge and catches up in bounded background batches', () => {
    const dir = root()
    const archive = open(dir)
    const db = connect(dir)
    // Seed efficiently, preserving the production triggers and all bookkeeping invariants.
    const seed = db.prepare(`INSERT INTO ended_turns
      (seq,node_id,turn_id,session_id,provider,outcome,ended_at,archived_at,message,truncated,superseded,message_bytes)
      VALUES (?,?,'turn','session','claude-code','completed',100,100,?,0,0,?)`)
    db.transaction(() => {
      for (let i = 0; i < 20_000; i++) {
        const text = i < 17_952 ? null : 'x'.repeat(65536)
        seed.run(i + 1, `n${i}`, text, text === null ? 0 : 65536)
      }
    }).immediate()
    expect(archive.append(endedTurn({ nodeId: 'extra', message: 'x'.repeat(65536) }))).toEqual({
      status: 'memory_only',
      reason: 'retention_backlog',
    })
    expect(db.prepare('SELECT record_count, next_seq FROM archive_schema').get()).toEqual({
      record_count: 20_000,
      next_seq: 20_001,
    })
    let batches = 0
    let result
    do {
      const before = (
        db.prepare('SELECT record_count AS n FROM archive_schema').get() as { n: number }
      ).n
      result = archive.sweep(100)
      const after = (
        db.prepare('SELECT record_count AS n FROM archive_schema').get() as { n: number }
      ).n
      expect(before - after).toBeLessThanOrEqual(256)
      batches++
    } while (result.status === 'more')
    expect(batches).toBe(71)
    expect(archive.append(endedTurn({ nodeId: 'extra', message: 'x'.repeat(65536) }))).toEqual({
      status: 'persisted',
    })
    expect(db.prepare('SELECT message_bytes FROM archive_schema').get()).toEqual({
      message_bytes: 128 * 1024 * 1024,
    })
  }, 30_000)

  it('disables automatic checkpoints and keeps manual checkpoints outside append', () => {
    const pragma = vi.spyOn(Database.prototype, 'pragma')
    const archive = open(root())
    expect(pragma).toHaveBeenCalledWith('wal_autocheckpoint = 0')
    pragma.mockClear()
    archive.append(endedTurn())
    expect(pragma).not.toHaveBeenCalled()
    archive.checkpoint()
    expect(pragma).toHaveBeenCalledWith('wal_checkpoint(PASSIVE)')
  })
})
