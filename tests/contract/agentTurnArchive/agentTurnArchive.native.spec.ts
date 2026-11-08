// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, expect, it } from 'vitest'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { createSqliteAgentTurnArchive } from '../../../src/contexts/agent/infrastructure/turnArchive/createSqliteAgentTurnArchive'
import {
  AGENT_TURN_ARCHIVE_BUSY_MS,
  AGENT_TURN_ARCHIVE_FILE,
} from '../../../src/contexts/agent/infrastructure/turnArchive/archiveSchema'
import {
  AGENT_TURN_ARCHIVE_LIMITS as limits,
  type AgentTurnArchive,
} from '../../../src/contexts/agent/application/AgentTurnArchive'
import {
  agentTurnArchiveContract,
  endedTurn,
} from '../../support/agentTurnArchive/agentTurnArchiveContract'

describeWithElectronNativeModules('ended-turn archive SQLite', () => {
  const roots: string[] = []
  const archives: AgentTurnArchive[] = []
  const connections: Database.Database[] = []
  const root = () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencove-turn-archive-'))
    roots.push(dir)
    return dir
  }
  const open = (userDataPath: string, now: () => number = () => 100) => {
    const archive = createSqliteAgentTurnArchive({ userDataPath, now, membership: () => 'member' })
    archives.push(archive)
    return archive
  }
  const connect = (dir: string) => {
    const db = new Database(join(dir, AGENT_TURN_ARCHIVE_FILE))
    connections.push(db)
    return db
  }
  const count = (db: Database.Database) =>
    (db.prepare('SELECT COUNT(*) AS n FROM ended_turns').get() as { n: number }).n
  afterEach(() => {
    archives.splice(0).forEach(archive => archive.dispose())
    connections.splice(0).forEach(db => {
      if (db.open) {
        db.close()
      }
    })
    roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }))
  })
  agentTurnArchiveContract(({ now }) => open(root(), now))

  it('reopens original identity, metadata and content without runtime hydration', () => {
    const dir = root()
    const archive = open(dir)
    for (const [turnId, message] of [
      ['text', 'private reply'],
      ['empty', ''],
      ['metadata', null],
    ] as const) {
      expect(
        archive.append(
          endedTurn({
            turnId,
            message,
            providerSessionId: 'provider-session',
            promptId: 'prompt',
            outcome: 'aborted',
            truncated: true,
            superseded: true,
          }),
        ),
      ).toEqual({ status: 'persisted' })
    }
    const before = archive.getExact({ nodeId: 'node', turnId: 'text' })
    archive.dispose()
    const reopened = open(dir)
    expect(reopened.getExactBySession({ sessionId: 'original-session', turnId: 'text' })).toEqual(
      before,
    )
    expect(reopened.getExact({ nodeId: 'node', turnId: 'empty' })).toMatchObject({
      status: 'found',
      record: { message: '' },
    })
    expect(reopened.getExact({ nodeId: 'node', turnId: 'metadata' })).toMatchObject({
      status: 'found',
      record: { message: null, outcome: 'aborted', truncated: true, superseded: true },
    })
    expect(readdirSync(dir).every(name => name.startsWith(AGENT_TURN_ARCHIVE_FILE))).toBe(true)
  })

  it('keeps duplicate sequence and archival age unchanged across reopen', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn())
    const original = archive.getExact({ nodeId: 'node', turnId: 'turn' })
    archive.dispose()
    const reopened = open(dir, () => 200)
    reopened.append(endedTurn({ message: 'changed', outcome: 'failed' }))
    expect(reopened.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual(original)
    reopened.append(endedTurn({ turnId: 'second' }))
    expect(reopened.getExact({ nodeId: 'node', turnId: 'second' })).toMatchObject({
      status: 'found',
      record: { archivedAt: 200 },
    })
  })

  it('enforces the global record budget on append, counting metadata-only rows', () => {
    const dir = root()
    const archive = open(dir)
    for (let i = 0; i <= limits.records; i++) {
      expect(archive.append(endedTurn({ nodeId: `node-${i}`, message: null }))).toEqual({
        status: 'persisted',
      })
    }
    expect(archive.getExact({ nodeId: 'node-0', turnId: 'turn' })).toEqual({ status: 'absent' })
    expect(archive.getExact({ nodeId: 'node-1', turnId: 'turn' })).toMatchObject({
      status: 'found',
    })
    expect(count(connect(dir))).toBe(limits.records)
  }, 30_000)

  it('enforces global UTF-8 bytes by evicting oldest whole records', () => {
    const dir = root()
    const archive = open(dir)
    const message = 'x'.repeat(64 * 1024)
    for (let i = 0; i <= limits.messageBytes / message.length; i++) {
      expect(archive.append(endedTurn({ nodeId: `node-${i}`, message }))).toEqual({
        status: 'persisted',
      })
    }
    expect(archive.getExact({ nodeId: 'node-0', turnId: 'turn' })).toEqual({ status: 'absent' })
    expect(archive.getExact({ nodeId: 'node-1', turnId: 'turn' })).toMatchObject({
      status: 'found',
    })
    const db = connect(dir)
    expect(db.prepare('SELECT SUM(message_bytes) AS bytes FROM ended_turns').get()).toEqual({
      bytes: limits.messageBytes,
    })
  }, 30_000)

  it('rolls back append if transactional retention fails', () => {
    const dir = root()
    const archive = open(dir)
    for (let i = 0; i < limits.perNode; i++) {
      archive.append(endedTurn({ turnId: String(i) }))
    }
    const db = connect(dir)
    db.exec(
      "CREATE TRIGGER refuse_prune BEFORE DELETE ON ended_turns BEGIN SELECT RAISE(ABORT, 'test'); END",
    )
    expect(archive.append(endedTurn({ turnId: 'overflow' }))).toEqual({
      status: 'memory_only',
      reason: 'write_failed',
    })
    expect(count(db)).toBe(limits.perNode)
    expect(db.prepare("SELECT 1 FROM ended_turns WHERE turn_id = 'overflow'").get()).toBeUndefined()
  })

  it('uses archived_at for age and bounds each expiry sweep batch', () => {
    const dir = root()
    const archive = open(dir)
    for (let i = 0; i < limits.sweepBatch + 10; i++) {
      archive.append(endedTurn({ nodeId: `n${i}`, endedAt: 1e15 }))
    }
    const db = connect(dir)
    archive.sweep(100 + limits.ageMs)
    expect(count(db)).toBe(limits.sweepBatch + 10)
    archive.sweep(101 + limits.ageMs)
    expect(count(db)).toBe(10)
    archive.sweep(101 + limits.ageMs)
    expect(count(db)).toBe(0)
  })

  it('bounds orphan scanning and eventually reaches orphans beyond surviving rows', () => {
    const dir = root()
    const archive = open(dir)
    const survivors = new Set<string>()
    for (let i = 0; i < limits.sweepBatch + 10; i++) {
      const nodeId = `n${i}`
      if (i < limits.sweepBatch) {
        survivors.add(nodeId)
      }
      archive.append(endedTurn({ nodeId }))
    }
    const db = connect(dir)
    archive.sweep(100, survivors)
    expect(count(db)).toBe(limits.sweepBatch + 10)
    archive.sweep(100, survivors)
    expect(count(db)).toBe(limits.sweepBatch)
    archive.sweep(100, new Set()) // Cursor resets after reaching the end.
    archive.sweep(100, new Set())
    expect(count(db)).toBe(0)
  })

  it('deletes revoked rows durably and fails closed if revocation cannot commit', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn())
    archive.revokeNodes(['node'])
    expect(count(connect(dir))).toBe(0)
    archive.dispose()
    const reopened = open(dir)
    expect(reopened.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual({
      status: 'absent',
    })
    reopened.append(endedTurn({ nodeId: 'other' }))
    const locker = connect(dir)
    locker.exec('BEGIN IMMEDIATE')
    try {
      reopened.revokeNodes(['other'])
      expect(reopened.getExactBySession({ sessionId: 'original-session', turnId: 'turn' })).toEqual(
        { status: 'unavailable' },
      )
      expect(reopened.append(endedTurn({ nodeId: 'other' }))).toEqual({
        status: 'memory_only',
        reason: 'deleted',
      })
    } finally {
      locker.exec('ROLLBACK')
    }
  })

  it('disables a newer schema without modifying the database or creating sidecars', () => {
    const dir = root()
    const db = connect(dir)
    db.exec('CREATE TABLE archive_schema (version INTEGER); INSERT INTO archive_schema VALUES (3)')
    db.close()
    const path = join(dir, AGENT_TURN_ARCHIVE_FILE)
    const original = readFileSync(path)
    const archive = open(dir)
    expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'unavailable' })
    archive.dispose()
    expect(readFileSync(path)).toEqual(original)
    expect(readdirSync(dir)).toEqual([AGENT_TURN_ARCHIVE_FILE])
  })

  it('rolls back malformed current-schema initialization without altering the file', () => {
    const dir = root()
    const db = connect(dir)
    db.exec('CREATE TABLE archive_schema (version INTEGER); INSERT INTO archive_schema VALUES (1)')
    db.close()
    const path = join(dir, AGENT_TURN_ARCHIVE_FILE)
    const original = readFileSync(path)
    const archive = open(dir)
    expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
    archive.dispose()
    expect(readFileSync(path)).toEqual(original)
    expect(readdirSync(dir)).toEqual([AGENT_TURN_ARCHIVE_FILE])
  })

  it('disables corrupt files without moving, replacing or truncating them', () => {
    const dir = root()
    const path = join(dir, AGENT_TURN_ARCHIVE_FILE)
    const original = Buffer.from('not SQLite; private bytes must survive')
    writeFileSync(path, original)
    const archive = open(dir)
    expect(archive.getExact({ nodeId: 'node', turnId: 'turn' })).toEqual({ status: 'unavailable' })
    expect(readFileSync(path)).toEqual(original)
    expect(readdirSync(dir)).toEqual([AGENT_TURN_ARCHIVE_FILE])
  })

  it('returns typed lock failures within the short busy budget and disables subsequent writes', () => {
    const dir = root()
    const archive = open(dir)
    const locker = connect(dir)
    locker.exec('BEGIN IMMEDIATE')
    try {
      const start = performance.now()
      expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'write_failed' })
      // Scheduling overhead is separate from SQLite's configured 50 ms wait (always <= 100 ms).
      expect(performance.now() - start).toBeLessThan(AGENT_TURN_ARCHIVE_BUSY_MS + 150)
      expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
      expect(count(locker)).toBe(0)
    } finally {
      locker.exec('ROLLBACK')
    }
  })

  it('disables locked startup without changing the original bytes', () => {
    const dir = root()
    open(dir).dispose()
    const locker = connect(dir)
    locker.pragma('journal_mode = DELETE')
    locker.exec('BEGIN EXCLUSIVE')
    const path = join(dir, AGENT_TURN_ARCHIVE_FILE)
    const original = readFileSync(path)
    try {
      const start = performance.now()
      const archive = open(dir)
      expect(archive.append(endedTurn())).toEqual({ status: 'memory_only', reason: 'unavailable' })
      expect(performance.now() - start).toBeLessThan(AGENT_TURN_ARCHIVE_BUSY_MS + 150)
      expect(readFileSync(path)).toEqual(original)
    } finally {
      locker.exec('ROLLBACK')
    }
  })
  it('upgrades the independent v1 archive and preserves intermediate semantics across reopen', () => {
    const dir = root()
    const archive = open(dir)
    archive.append(endedTurn({ messageKind: 'intermediate', outcome: 'unknown' }))
    archive.dispose()
    const reopened = open(dir)
    expect(reopened.getExact({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
      status: 'found',
      record: { messageKind: 'intermediate', outcome: 'unknown' },
    })
    reopened.dispose()
    const db = connect(dir)
    db.exec(
      'ALTER TABLE ended_turns DROP COLUMN message_kind; UPDATE archive_schema SET version = 1',
    )
    db.close()
    const upgraded = open(dir)
    expect(upgraded.getExact({ nodeId: 'node', turnId: 'turn' })).toMatchObject({
      status: 'found',
      record: { message: 'reply', outcome: 'unknown' },
    })
    expect(connect(dir).prepare('SELECT version FROM archive_schema').get()).toEqual({ version: 2 })
  })
})
