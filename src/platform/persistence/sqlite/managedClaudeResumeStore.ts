import type Database from 'better-sqlite3'
import type {
  ManagedClaudeResumeBindingStore,
  ManagedResumeBindingResult,
  ManagedResumeBindingTuple,
} from '../../../shared/contracts/managedClaudeResumeBinding'
import { sameManagedResumeBinding } from '../../../shared/contracts/managedClaudeResumeBinding'
import { managedClaudeIdentityConflict } from '../../../shared/sync/managedClaudeResumeIdentity'
import { rowTuple, type ManagedResumeBindingRow } from './managedClaudeResumeGate'
import { safeJsonParse, safeJsonStringify } from './utils'

export function readAppStateRevisionFromDb(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'app_state_revision'").get() as
    | { value: string }
    | undefined
  const value = Number.parseInt(row?.value ?? '0', 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** No external IO or await inside these transactions. Notifications belong to the caller. */
export function createManagedClaudeResumeStore(
  db: Database.Database,
  readState: () => unknown,
): ManagedClaudeResumeBindingStore {
  const readRow = (nodeId: string) =>
    db.prepare('SELECT * FROM managed_claude_resume_bindings WHERE node_id = ?').get(nodeId) as
      | ManagedResumeBindingRow
      | undefined
  const retired = (nodeId: string) =>
    Boolean(db.prepare('SELECT 1 FROM retired_managed_nodes WHERE node_id = ?').get(nodeId))
  const snapshot = () => ({ revision: readAppStateRevisionFromDb(db), effectiveState: readState() })
  const apply = (
    nodeId: string,
    activationId: string,
    runtimeSessionId: string | null,
    tuple: ManagedResumeBindingTuple,
  ): ManagedResumeBindingResult => {
    const node = db.prepare('SELECT kind, agent_json FROM nodes WHERE id = ?').get(nodeId) as
      | { kind: string; agent_json: string | null }
      | undefined
    const parsed = safeJsonParse(node?.agent_json ?? '')
    const agent =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    if (node && managedClaudeIdentityConflict({ kind: node.kind, agent })) {
      return { status: 'conflict' }
    }
    const revision = readAppStateRevisionFromDb(db) + (node ? 1 : 0)
    db.prepare(
      `INSERT INTO managed_claude_resume_bindings
      (node_id, runtime_session_id, resume_session_id, resume_session_id_verified, activation_id, node_seen, updated_revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET runtime_session_id = excluded.runtime_session_id,
        resume_session_id = excluded.resume_session_id, resume_session_id_verified = excluded.resume_session_id_verified,
        activation_id = excluded.activation_id, node_seen = MAX(node_seen, excluded.node_seen),
        updated_revision = excluded.updated_revision, updated_at = excluded.updated_at`,
    ).run(
      nodeId,
      runtimeSessionId,
      tuple.resumeSessionId,
      tuple.resumeSessionIdVerified ? 1 : 0,
      activationId,
      node ? 1 : 0,
      revision,
      Date.now(),
    )
    if (!node) {
      return { status: 'committed' }
    }
    db.prepare('UPDATE nodes SET agent_json = ?, session_id = ? WHERE id = ?').run(
      safeJsonStringify({ ...agent, ...tuple }),
      runtimeSessionId,
      nodeId,
    )
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('app_state_revision', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(revision))
    return { status: 'committed', revision, effectiveState: readState() }
  }
  const transaction = (body: () => ManagedResumeBindingResult): ManagedResumeBindingResult => {
    let finished = false
    try {
      return db
        .transaction(() => {
          const result = body()
          finished = true
          return result
        })
        .immediate()
    } catch {
      // A body error is rolled back by better-sqlite3. A commit/rollback failure may be ambiguous.
      return {
        status: 'retryableFailure',
        outcome: finished || db.inTransaction ? 'unknown' : 'notCommitted',
      }
    }
  }
  return {
    activateManagedClaudeRuntime: async input =>
      transaction(() => {
        if (retired(input.nodeId)) {
          return { status: 'nodeGone' }
        }
        const row = readRow(input.nodeId)
        if (
          input.expected &&
          (input.expected.activationId !== (row?.activation_id ?? null) ||
            !sameManagedResumeBinding(
              input.expected.tuple,
              row ? rowTuple(row) : { resumeSessionId: null, resumeSessionIdVerified: false },
            ))
        ) {
          return { status: 'superseded' }
        }
        if (row?.activation_id === input.activationId) {
          return row.runtime_session_id === input.runtimeSessionId &&
            sameManagedResumeBinding(rowTuple(row), input.tuple)
            ? { status: 'alreadyApplied', ...snapshot() }
            : { status: 'conflict' }
        }
        return apply(input.nodeId, input.activationId, input.runtimeSessionId, input.tuple)
      }),
    commitManagedClaudeRebind: async input =>
      transaction(() => {
        if (retired(input.nodeId)) {
          return { status: 'nodeGone' }
        }
        const row = readRow(input.nodeId)
        if (!row) {
          return { status: 'nodeGone' }
        }
        if (row.runtime_session_id !== input.runtimeSessionId) {
          return { status: 'superseded' }
        }
        if (row.activation_id === input.activationId) {
          return sameManagedResumeBinding(rowTuple(row), input.next)
            ? { status: 'alreadyApplied', ...snapshot() }
            : { status: 'conflict' }
        }
        if (!sameManagedResumeBinding(rowTuple(row), input.expected)) {
          return { status: 'conflict' }
        }
        return apply(input.nodeId, input.activationId, row.runtime_session_id, input.next)
      }),
  }
}
