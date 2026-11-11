import type Database from 'better-sqlite3'
import type { NodeLineageRepository } from '../../application/nodeLineage/NodeLineageRepository'
import type { NodeLineageRecord } from '../../domain/nodeLineage'
import { createAppError } from '../../../../shared/errors/appError'

export function ensureNodeLineageSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS node_lineage (
      node_id TEXT PRIMARY KEY NOT NULL,
      spawned_by_node_id TEXT NOT NULL CHECK (spawned_by_node_id <> node_id),
      root_node_id TEXT NOT NULL CHECK (root_node_id <> node_id),
      lineage_depth INTEGER NOT NULL CHECK (typeof(lineage_depth) = 'integer' AND lineage_depth >= 2)
    );
    CREATE INDEX IF NOT EXISTS node_lineage_parent_idx ON node_lineage(spawned_by_node_id);
    CREATE INDEX IF NOT EXISTS node_lineage_root_idx ON node_lineage(root_node_id);
  `)
}
export function createSqliteNodeLineageRepository(db: Database.Database): NodeLineageRepository {
  return {
    readAll: async () => {
      const rows = db
        .prepare(
          `SELECT node_id AS nodeId, spawned_by_node_id AS spawnedBy,
        root_node_id AS rootNodeId, lineage_depth AS lineageDepth FROM node_lineage`,
        )
        .all() as NodeLineageRecord[]
      return new Map(rows.map(row => [row.nodeId, row]))
    },
    readMany: async nodeIds => {
      const query = db.prepare(`SELECT node_id AS nodeId, spawned_by_node_id AS spawnedBy,
      root_node_id AS rootNodeId, lineage_depth AS lineageDepth FROM node_lineage WHERE node_id = ?`)
      const rows = new Map<string, NodeLineageRecord>()
      for (const id of new Set(nodeIds)) {
        const row = query.get(id) as NodeLineageRecord | undefined
        if (row) {
          rows.set(id, row)
        }
      }
      return rows
    },
  }
}
/** Called within the node writer's transaction on the same connection. */
export function insertNodeLineage(db: Database.Database, record: NodeLineageRecord): void {
  const existing = db
    .prepare(
      `SELECT spawned_by_node_id AS spawnedBy, root_node_id AS rootNodeId,
    lineage_depth AS lineageDepth FROM node_lineage WHERE node_id = ?`,
    )
    .get(record.nodeId) as Omit<NodeLineageRecord, 'nodeId'> | undefined
  if (existing) {
    if (
      existing.spawnedBy !== record.spawnedBy ||
      existing.rootNodeId !== record.rootNodeId ||
      existing.lineageDepth !== record.lineageDepth
    ) {
      throw createAppError('persistence.invalid_state')
    }
    return
  }
  // New identities cannot already be an ancestor of an existing row.
  if (
    db
      .prepare(
        'SELECT 1 FROM node_lineage WHERE spawned_by_node_id = ? OR root_node_id = ? LIMIT 1',
      )
      .get(record.nodeId, record.nodeId)
  ) {
    throw createAppError('persistence.invalid_state')
  }
  db.prepare(
    'INSERT INTO node_lineage (node_id, spawned_by_node_id, root_node_id, lineage_depth) VALUES (?, ?, ?, ?)',
  ).run(record.nodeId, record.spawnedBy, record.rootNodeId, record.lineageDepth)
}
