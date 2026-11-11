import type Database from 'better-sqlite3'
import { safeJsonParse } from './utils'
import { normalizeNodeWorkerBinding } from '../../../shared/types/nodeWorkerBinding'

/** Compare conversation/runtime identity, never the initiating UI’s transitional presentation. */
export function readManagedClaudeAdoptionSnapshot(db: Database.Database, nodeId: string): string {
  const row = db
    .prepare(
      `SELECT kind, agent_json, session_id, execution_directory, worker_binding_json
    FROM nodes WHERE id = ?`,
    )
    .get(nodeId) as Record<string, unknown> | undefined
  if (!row) {
    return 'null'
  }
  const agent = safeJsonParse(String(row.agent_json ?? '')) as Record<string, unknown> | null
  return JSON.stringify({
    kind: row.kind,
    provider: agent?.provider ?? null,
    tuple: {
      resumeSessionId: agent?.resumeSessionId ?? null,
      resumeSessionIdVerified: agent?.resumeSessionIdVerified === true,
    },
    // Only unverified blank-agent eligibility affects automatic first launch.
    blankAgent:
      agent?.resumeSessionIdVerified === true ? null : String(agent?.prompt ?? '').trim() === '',
    runtime: row.session_id,
    directory: agent?.executionDirectory ?? row.execution_directory,
    route: normalizeNodeWorkerBinding(safeJsonParse(String(row.worker_binding_json ?? ''))),
  })
}
