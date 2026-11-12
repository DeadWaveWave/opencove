import type Database from 'better-sqlite3'
import type { TaskAuthorityRecord } from '../../../shared/contracts/taskAuthority'
import type { TaskHolderIdentity } from '../../../contexts/task/application/TaskMutationRepository'

export function readTaskAuthority(
  db: Database.Database,
  nodeId: string,
): TaskAuthorityRecord | null {
  const row = db
    .prepare('SELECT fields_json FROM task_field_authority WHERE node_id = ?')
    .get(nodeId) as { fields_json: string } | undefined
  return row ? (JSON.parse(row.fields_json) as TaskAuthorityRecord) : null
}
export function readAllTaskAuthority(db: Database.Database): TaskAuthorityRecord[] {
  return (
    db.prepare('SELECT fields_json FROM task_field_authority').all() as { fields_json: string }[]
  ).map(row => JSON.parse(row.fields_json) as TaskAuthorityRecord)
}
export function readTaskHolder(db: Database.Database, nodeId: string): TaskHolderIdentity | null {
  return (
    (db
      .prepare(
        `SELECT id AS nodeId, workspace_id AS projectId, kind, session_id AS sessionId,
    worker_binding_json AS workerBinding FROM nodes WHERE id = ?`,
      )
      .get(nodeId) as TaskHolderIdentity | undefined) ?? null
  )
}
