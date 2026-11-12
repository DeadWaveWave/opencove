import { readManagedClaudeAdoptionSnapshot } from './managedClaudeAdoptionSnapshot'
import type Database from 'better-sqlite3'
import type { ManagedClaudeNodeObservation } from '../../../shared/contracts/managedClaudeLaunch'
import { createAppError } from '../../../shared/errors/appError'
import { normalizeNodeWorkerBinding } from '../../../shared/types/nodeWorkerBinding'
import { rowTuple, type ManagedResumeBindingRow } from './managedClaudeResumeGate'
import { readAppStateRevisionFromDb } from './managedClaudeResumeStore'
import { safeJsonParse } from './utils'

export interface ManagedClaudeResumeRead {
  observeManagedClaudeNode(nodeId: string): ManagedClaudeNodeObservation
  managedClaudePreparationCandidates(
    workspaceId: string,
    nodeIds?: readonly string[],
  ): readonly string[]
  managedClaudeNodeIdForRuntime(runtimeSessionId: string): string | null
  isManagedClaudeRuntimeReferenced(runtimeSessionId: string): boolean
}

export function createManagedClaudeResumeRead(db: Database.Database): ManagedClaudeResumeRead {
  const definitive = <T>(read: () => T): T => {
    // Same-connection uncommitted visibility cannot prove an unknown write committed.
    if (db.inTransaction) {
      throw createAppError('persistence.unavailable')
    }
    try {
      return db.transaction(read)()
    } catch {
      throw createAppError('persistence.unavailable')
    }
  }
  return {
    observeManagedClaudeNode: nodeId =>
      definitive(() => {
        const row = db
          .prepare('SELECT * FROM managed_claude_resume_bindings WHERE node_id = ?')
          .get(nodeId) as ManagedResumeBindingRow | undefined
        const node = db
          .prepare(
            'SELECT kind, agent_json, worker_binding_json, execution_directory, session_id FROM nodes WHERE id = ?',
          )
          .get(nodeId) as
          | {
              kind: string
              agent_json: string | null
              worker_binding_json: string | null
              execution_directory: string | null
              session_id: string | null
            }
          | undefined
        const agent = safeJsonParse(node?.agent_json ?? '') as Record<string, unknown> | null
        return {
          nodeId,
          adoptionSnapshot: row ? undefined : readManagedClaudeAdoptionSnapshot(db, nodeId),
          nodeRuntimeSessionId: node?.session_id ?? null,
          retired: Boolean(
            db.prepare('SELECT 1 FROM retired_managed_nodes WHERE node_id = ?').get(nodeId),
          ),
          context: node
            ? {
                kind: node.kind,
                provider: typeof agent?.provider === 'string' ? agent.provider : null,
                directory:
                  typeof agent?.executionDirectory === 'string'
                    ? agent.executionDirectory
                    : node.execution_directory,
                route: JSON.stringify(
                  normalizeNodeWorkerBinding(safeJsonParse(node.worker_binding_json ?? '')),
                ),
              }
            : null,
          binding: row
            ? {
                nodeId,
                activationId: row.activation_id,
                runtimeSessionId: row.runtime_session_id,
                tuple: rowTuple(row),
                nodeSeen: row.node_seen === 1,
                bindingRevision: row.updated_revision,
                observedRevision: readAppStateRevisionFromDb(db),
              }
            : null,
        }
      }),
    managedClaudePreparationCandidates: (workspaceId, nodeIds) =>
      definitive(() => {
        const rows = db
          .prepare("SELECT id FROM nodes WHERE workspace_id = ? AND kind = 'agent'")
          .all(workspaceId) as { id: string }[]
        return rows.map(row => row.id).filter(id => !nodeIds || nodeIds.includes(id))
      }),
    managedClaudeNodeIdForRuntime: runtimeSessionId =>
      definitive(() => {
        const row = db
          .prepare(
            'SELECT node_id FROM managed_claude_resume_bindings WHERE runtime_session_id = ? UNION ALL SELECT b.node_id FROM managed_claude_resume_bindings b JOIN nodes n ON n.id = b.node_id WHERE n.session_id = ? LIMIT 1',
          )
          .get(runtimeSessionId, runtimeSessionId) as { node_id: string } | undefined
        return row?.node_id ?? null
      }),
    isManagedClaudeRuntimeReferenced: runtimeSessionId =>
      definitive(() =>
        Boolean(
          db
            .prepare(
              'SELECT 1 FROM managed_claude_resume_bindings WHERE runtime_session_id = ? UNION ALL SELECT 1 FROM nodes WHERE session_id = ? LIMIT 1',
            )
            .get(runtimeSessionId, runtimeSessionId),
        ),
      ),
  }
}
