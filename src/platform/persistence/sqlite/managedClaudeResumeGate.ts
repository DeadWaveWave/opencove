import type Database from 'better-sqlite3'
import type { ManagedResumeBindingTuple } from '../../../shared/contracts/managedClaudeResumeBinding'
import { createAppError } from '../../../shared/errors/appError'
import { managedClaudeIdentityConflict } from '../../../shared/sync/managedClaudeResumeIdentity'
import type { NormalizedPersistedAppState } from './normalize'
import { safeJsonParse } from './utils'

export interface ManagedResumeBindingRow {
  node_id: string
  runtime_session_id: string | null
  resume_session_id: string | null
  resume_session_id_verified: number
  activation_id: string
  node_seen: number
  updated_revision: number
  updated_at: number
}

export function rowTuple(row: ManagedResumeBindingRow): ManagedResumeBindingTuple {
  return {
    resumeSessionId: row.resume_session_id,
    resumeSessionIdVerified: row.resume_session_id_verified === 1,
  }
}

export function ownedIdentityConflict(
  nodeId: string,
  field: string,
  reason = 'incompatible',
): never {
  throw createAppError('persistence.owned_node_identity_conflict', {
    details: { nodeId, field, reason },
  })
}

export function enforceManagedClaudeResumeBindings(
  db: Database.Database,
  state: NormalizedPersistedAppState,
  revision: number,
): { effectiveState: NormalizedPersistedAppState; corrected: boolean } {
  const readBinding = db.prepare('SELECT * FROM managed_claude_resume_bindings WHERE node_id = ?')
  const readRetired = db.prepare('SELECT 1 FROM retired_managed_nodes WHERE node_id = ?')
  const readStored = db.prepare('SELECT worker_binding_json FROM nodes WHERE id = ?')
  let corrected = false
  const effectiveState = {
    ...state,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes.map(node => {
        if (readRetired.get(node.id)) {
          ownedIdentityConflict(node.id, 'id', 'retired')
        }
        const row = readBinding.get(node.id) as ManagedResumeBindingRow | undefined
        if (!row) {
          return node
        }
        const stored = readStored.get(node.id) as { worker_binding_json: string | null } | undefined
        const field = managedClaudeIdentityConflict(
          node,
          stored ? { workerBinding: safeJsonParse(stored.worker_binding_json ?? '') } : undefined,
        )
        if (field) {
          ownedIdentityConflict(node.id, field)
        }
        if (row.node_seen === 0) {
          db.prepare(
            'UPDATE managed_claude_resume_bindings SET node_seen = 1, updated_revision = ?, updated_at = ? WHERE node_id = ?',
          ).run(revision, Date.now(), node.id)
        }
        const agent = node.agent as Record<string, unknown>
        const tuple = rowTuple(row)
        const sessionId = row.runtime_session_id ?? node.sessionId
        if (
          agent.resumeSessionId === tuple.resumeSessionId &&
          agent.resumeSessionIdVerified === tuple.resumeSessionIdVerified &&
          node.sessionId === sessionId
        ) {
          return node
        }
        corrected = true
        return { ...node, sessionId, agent: { ...agent, ...tuple } }
      }),
    })),
  }
  return { effectiveState: corrected ? effectiveState : state, corrected }
}

export function retireDeletedManagedNodes(db: Database.Database, revision: number): void {
  db.prepare(
    `INSERT INTO retired_managed_nodes (node_id, retired_revision, retired_at)
    SELECT node_id, ?, ? FROM managed_claude_resume_bindings
    WHERE node_seen = 1 AND NOT EXISTS (SELECT 1 FROM nodes WHERE id = node_id)`,
  ).run(revision, Date.now())
  db.exec(`DELETE FROM managed_claude_resume_bindings
    WHERE node_seen = 1 AND NOT EXISTS (SELECT 1 FROM nodes WHERE id = node_id)`)
}
