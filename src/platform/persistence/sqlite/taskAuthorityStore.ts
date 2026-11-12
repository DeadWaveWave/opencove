import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type {
  TaskCommandReceipt,
  TaskAuthorityRecord,
} from '../../../shared/contracts/taskAuthority'
import type {
  TaskMutationRepository,
  TaskMutationTransaction,
} from '../../../contexts/task/application/TaskMutationRepository'
import {
  projectTaskAuthorityRecord,
  taskObject,
} from '../../../shared/sync/taskAuthorityProjection'
import { readAppStateRevisionFromDb } from './managedClaudeResumeStore'
import { readAllTaskAuthority, readTaskAuthority, readTaskHolder } from './taskAuthorityRead'
export { activateTaskAuthority } from './taskAuthorityAdoption'

/** Caller must already be inside an immediate transaction. No external IO here. */
export function saveTaskAuthority(
  db: Database.Database,
  record: TaskAuthorityRecord,
  projectLinks = true,
): void {
  db.prepare(
    `INSERT INTO task_field_authority (node_id, project_id, kind, generation, active_holder_node_id, retired, fields_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(node_id) DO UPDATE SET
    project_id = excluded.project_id, kind = excluded.kind, generation = excluded.generation,
    active_holder_node_id = excluded.active_holder_node_id, retired = excluded.retired, fields_json = excluded.fields_json`,
  ).run(
    record.nodeId,
    record.projectId,
    record.kind,
    record.generation,
    record.retired ? null : (record.claim?.holderNodeId ?? null),
    record.retired ? 1 : 0,
    JSON.stringify(record),
  )
  db.prepare('DELETE FROM task_claim_holders WHERE task_node_id = ?').run(record.nodeId)
  if (!record.retired && record.claim) {
    const holder = readTaskHolder(db, record.claim.holderNodeId)
    if (!holder) {
      throw new Error('Task holder disappeared within the transaction')
    }
    db.prepare(
      `INSERT INTO task_claim_holders (task_node_id, node_id, project_id, kind, session_id, worker_binding_json)
      VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      record.nodeId,
      holder.nodeId,
      holder.projectId,
      holder.kind,
      holder.sessionId,
      holder.workerBinding,
    )
  }
  if (record.retired) {
    db.prepare('DELETE FROM workspace_space_nodes WHERE node_id = ?').run(record.nodeId)
    db.prepare('DELETE FROM nodes WHERE id = ?').run(record.nodeId)
  } else {
    const node = db.prepare('SELECT task_json FROM nodes WHERE id = ?').get(record.nodeId) as
      | { task_json: string | null }
      | undefined
    if (!node) {
      throw new Error('Task node disappeared within the transaction')
    }
    db.prepare('UPDATE nodes SET task_json = ? WHERE id = ?').run(
      JSON.stringify(
        projectTaskAuthorityRecord(record, node.task_json ? JSON.parse(node.task_json) : null),
      ),
      record.nodeId,
    )
  }
  if (projectLinks) {
    projectReverseLinks(db)
  }
}

export function projectReverseLinks(db: Database.Database): void {
  const records = readAllTaskAuthority(db)
  const projects = new Set(records.map(r => r.projectId))
  const open = new Map(
    records.filter(r => !r.retired && r.claim).map(r => [r.claim!.holderNodeId, r.nodeId]),
  )
  const agents = db
    .prepare("SELECT id, workspace_id, agent_json FROM nodes WHERE kind = 'agent'")
    .all() as { id: string; workspace_id: string; agent_json: string | null }[]
  const update = db.prepare('UPDATE nodes SET agent_json = ? WHERE id = ?')
  for (const agent of agents) {
    if (!projects.has(agent.workspace_id)) {
      continue
    }
    update.run(
      JSON.stringify({
        ...taskObject(agent.agent_json ? JSON.parse(agent.agent_json) : null),
        taskId: open.get(agent.id) ?? null,
      }),
      agent.id,
    )
  }
}

export function advanceTaskRevision(db: Database.Database): number {
  const revision = readAppStateRevisionFromDb(db) + 1
  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('app_state_revision', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(revision))
  return revision
}

export function createTaskAuthorityRepository(
  db: Database.Database,
  onCommitted?: (receipt: TaskCommandReceipt) => void,
): TaskMutationRepository {
  const tx: TaskMutationTransaction = {
    read: id => readTaskAuthority(db, id),
    list: () => readAllTaskAuthority(db),
    holder: id => readTaskHolder(db, id),
    save: record => saveTaskAuthority(db, record),
    revision: () => readAppStateRevisionFromDb(db),
    advanceRevision: () => advanceTaskRevision(db),
    receipt: (principal, operation, requestId) => {
      const row = db
        .prepare(
          `SELECT fingerprint, result_json FROM task_command_receipts
        WHERE principal = ? AND operation = ? AND request_id = ?`,
        )
        .get(principal, operation, requestId) as
        | { fingerprint: string; result_json: string }
        | undefined
      return row
        ? {
            fingerprint: row.fingerprint,
            result: JSON.parse(row.result_json) as TaskCommandReceipt,
          }
        : null
    },
    saveReceipt: (principal, fingerprint, result) => {
      db.prepare(
        'INSERT INTO task_command_receipts (principal, operation, request_id, fingerprint, result_json) VALUES (?, ?, ?, ?, ?)',
      ).run(principal, result.operation, result.requestId, fingerprint, JSON.stringify(result))
    },
  }
  return {
    fingerprint: normalized => createHash('sha256').update(normalized, 'utf8').digest('hex'),
    transaction: body => {
      if (db.inTransaction) {
        throw new Error('Task commands require a clean transaction boundary')
      }
      return db.transaction(() => body(tx)).immediate()
    },
    committed: receipt => onCommitted?.(receipt),
  }
}
