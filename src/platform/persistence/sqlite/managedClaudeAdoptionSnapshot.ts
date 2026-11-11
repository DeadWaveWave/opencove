import type Database from 'better-sqlite3'
import { safeJsonParse } from './utils'
import { normalizeNodeWorkerBinding } from '../../../shared/types/nodeWorkerBinding'

/** Relevant legacy recovery truth only: geometry/title edits must not invalidate adoption. */
export function readManagedClaudeAdoptionSnapshot(db: Database.Database, nodeId: string): string {
  const row = db
    .prepare(
      `SELECT kind, agent_json, session_id, status, started_at, ended_at,
    exit_code, execution_directory, expected_directory, worker_binding_json
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
    prompt: agent?.prompt ?? null,
    launchMode: agent?.launchMode ?? null,
    runtime: row.session_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    directory: agent?.executionDirectory ?? row.execution_directory,
    expectedDirectory: agent?.expectedDirectory ?? row.expected_directory,
    route: normalizeNodeWorkerBinding(safeJsonParse(String(row.worker_binding_json ?? ''))),
  })
}
