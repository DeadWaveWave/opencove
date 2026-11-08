import type Database from 'better-sqlite3'
import {
  AGENT_TURN_ARCHIVE_LIMITS as limits,
  type ArchivedAgentTurn,
} from '../../application/AgentTurnArchive'
import {
  planArchiveEviction,
  type AgentTurnArchiveStorage,
  type StoredAgentTurnInput,
  type ArchiveBudgetRow,
} from '../../application/createAgentTurnArchive'

const columns = `node_id AS nodeId, turn_id AS turnId, seq, session_id AS sessionId,
  provider, provider_session_id AS providerSessionId, prompt_id AS promptId, outcome,
  ended_at AS endedAt, archived_at AS archivedAt, message, message_kind AS messageKind, truncated, superseded,
  message_bytes AS messageBytes`

export function createSqliteArchiveStorage(db: Database.Database): AgentTurnArchiveStorage {
  const insert = db.prepare(`INSERT INTO ended_turns (
    seq, node_id, turn_id, session_id, provider, provider_session_id, prompt_id, outcome,
    ended_at, archived_at, message, message_kind, truncated, superseded, message_bytes
  ) VALUES ((SELECT next_seq FROM archive_schema WHERE id = 1), @nodeId, @turnId, @sessionId, @provider, @providerSessionId, @promptId, @outcome,
    @endedAt, @archivedAt, @message, @messageKind, @truncated, @superseded, @messageBytes)
    ON CONFLICT(node_id, turn_id) DO NOTHING`)
  const duplicate = db.prepare('SELECT 1 FROM ended_turns WHERE node_id = ? AND turn_id = ?')
  const nodeRows = db.prepare(
    'SELECT seq, message_bytes AS messageBytes FROM ended_turns WHERE node_id = ? ORDER BY seq LIMIT ?',
  )
  const oldest = db.prepare(
    'SELECT seq, message_bytes AS messageBytes FROM ended_turns ORDER BY seq LIMIT ?',
  )
  const totals = db.prepare(
    'SELECT record_count AS records, message_bytes AS bytes FROM archive_schema WHERE id = 1',
  )
  const watermark = db.prepare('SELECT next_seq - 1 AS seq FROM archive_schema WHERE id = 1')
  const exact = db.prepare(`SELECT ${columns} FROM ended_turns WHERE node_id = ? AND turn_id = ?`)
  const session = db.prepare(
    `SELECT ${columns} FROM ended_turns WHERE session_id = ? AND turn_id = ? ORDER BY seq LIMIT 1`,
  )
  const revoke = db.prepare('DELETE FROM ended_turns WHERE node_id = ?')
  const expire = db.prepare(`DELETE FROM ended_turns WHERE seq IN (
    SELECT seq FROM ended_turns WHERE archived_at < ? ORDER BY archived_at, seq LIMIT ?)`)
  const scan = db.prepare(
    'SELECT seq, node_id AS nodeId FROM ended_turns WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?',
  )
  const deleteOne = db.prepare('DELETE FROM ended_turns WHERE seq = ?')
  let sweepCursor = 0
  let sweepWatermark: number | undefined
  let reserveBytes = 0
  let reserveRecords = 0
  const budget = () => totals.get() as { records: number; bytes: number }
  const captureWatermark = () => (watermark.get() as { seq: number }).seq
  const append = db.transaction((record: StoredAgentTurnInput) => {
    if (duplicate.get(record.nodeId, record.turnId)) {
      return 'persisted' as const
    }
    const victims = planArchiveEviction(
      budget(),
      record.messageBytes,
      nodeRows.all(
        record.nodeId,
        limits.perNode + limits.appendEvictions + 1,
      ) as ArchiveBudgetRow[],
      oldest.all(limits.appendEvictions + 1) as ArchiveBudgetRow[],
    )
    if (victims === null) {
      reserveBytes = Math.max(reserveBytes, record.messageBytes)
      reserveRecords = 1
      return 'retention_backlog' as const
    }
    insert.run({
      ...record,
      messageKind: record.messageKind ?? null,
      truncated: Number(record.truncated),
      superseded: Number(record.superseded),
    })
    for (const seq of victims) {
      deleteOne.run(seq)
    }
    return 'persisted' as const
  })
  const revokeNodes = db.transaction((ids: readonly string[]) => {
    for (const id of ids) {
      revoke.run(id)
    }
  })
  const sweep = db.transaction(
    (now: number, existingNodeIds?: ReadonlySet<string>, throughSeq = captureWatermark()) => {
      let remaining = limits.sweepBatch as number
      const current = budget()
      if (
        current.records > limits.records - reserveRecords ||
        current.bytes > limits.messageBytes - reserveBytes
      ) {
        const rows = oldest.all(remaining) as ArchiveBudgetRow[]
        for (const row of rows) {
          if (
            current.records <= limits.records - reserveRecords &&
            current.bytes <= limits.messageBytes - reserveBytes
          ) {
            break
          }
          deleteOne.run(row.seq)
          current.records--
          current.bytes -= row.messageBytes
          remaining--
        }
        if (
          current.records > limits.records - reserveRecords ||
          current.bytes > limits.messageBytes - reserveBytes
        ) {
          return true
        }
      }
      reserveBytes = 0
      reserveRecords = 0
      remaining -= expire.run(now - limits.ageMs, remaining).changes
      if (!remaining) {
        return true
      }
      if (!existingNodeIds) {
        return false
      }
      if (sweepWatermark !== throughSeq) {
        sweepCursor = 0
        sweepWatermark = throughSeq
      }
      const batch = scan.all(sweepCursor, throughSeq, remaining) as {
        seq: number
        nodeId: string
      }[]
      for (const row of batch) {
        if (!existingNodeIds.has(row.nodeId)) {
          deleteOne.run(row.seq)
        }
      }
      sweepCursor = batch.at(-1)?.seq ?? 0
      if (batch.length === remaining) {
        return true
      }
      sweepCursor = 0
      sweepWatermark = undefined
      return false
    },
  )
  const decode = (value: unknown): ArchivedAgentTurn | undefined => {
    if (!value) {
      return undefined
    }
    const row = value as ArchivedAgentTurn
    return {
      ...row,
      messageKind: row.messageKind ?? undefined,
      truncated: Boolean(row.truncated),
      superseded: Boolean(row.superseded),
    }
  }
  const checkpoint = () => {
    db.pragma('wal_checkpoint(PASSIVE)')
  }
  return {
    append: record => append.immediate(record),
    getExact: (nodeId, turnId) => decode(exact.get(nodeId, turnId)),
    getExactBySession: (sessionId, turnId) => decode(session.get(sessionId, turnId)),
    revokeNodes: ids => revokeNodes.immediate(ids),
    captureWatermark,
    sweep: (now, existing, through) => sweep.immediate(now, existing, through),
    checkpoint,
    dispose: () => {
      if (db.open) {
        db.close()
      }
    },
  }
}
