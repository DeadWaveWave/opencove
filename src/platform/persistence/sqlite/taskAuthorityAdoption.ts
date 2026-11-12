import type Database from 'better-sqlite3'
import type { TaskAuthorityRecord } from '../../../shared/contracts/taskAuthority'
import type { PersistedTaskAgentSessionRecord } from '../../../shared/contracts/persistedAppState'
import { createAppError } from '../../../shared/errors/appError'
import { taskObject } from '../../../shared/sync/taskAuthorityProjection'
import { readAppStateRevisionFromDb } from './managedClaudeResumeStore'
import { advanceTaskRevision, projectReverseLinks, saveTaskAuthority } from './taskAuthorityStore'

/** Internal activation only. Never seed authority from submitted snapshots or import payloads. */
export function activateTaskAuthority(
  db: Database.Database,
  identifiers: { uuid(): string; now(): string },
): number {
  if (db.inTransaction) {
    throw createAppError('persistence.unavailable')
  }
  return db
    .transaction(() => {
      if (
        db
          .prepare("SELECT 1 FROM app_meta WHERE key = 'task_authority_active' AND value = '1'")
          .get()
      ) {
        return readAppStateRevisionFromDb(db)
      }
      const nodes = db.prepare('SELECT id, workspace_id, kind, task_json FROM nodes').all() as {
        id: string
        workspace_id: string
        kind: string
        task_json: string | null
      }[]
      const byId = new Map(nodes.map(node => [node.id, node]))
      const records: TaskAuthorityRecord[] = []
      for (const node of nodes) {
        if (node.kind !== 'task' && node.kind !== 'note') {
          continue
        }
        const task = taskObject(node.task_json ? JSON.parse(node.task_json) : null)
        const status = ['todo', 'doing', 'ai_done', 'done'].includes(String(task.status))
          ? (task.status as TaskAuthorityRecord['status'])
          : 'todo'
        const linked = typeof task.linkedAgentNodeId === 'string' ? task.linkedAgentNodeId : null
        const holder = linked ? byId.get(linked) : null
        const validHolder = holder?.workspace_id === node.workspace_id && holder.kind === 'agent'
        const unverifiedHolder =
          holder?.workspace_id === node.workspace_id && holder.kind === 'terminal'
        const closed = status === 'done' || status === 'ai_done'
        records.push({
          nodeId: node.id,
          projectId: node.workspace_id,
          kind: node.kind,
          generation: identifiers.uuid(),
          version: 1,
          retired: false,
          status: node.kind === 'note' ? 'todo' : closed ? status : validHolder ? 'doing' : 'todo',
          linkedAgentNodeId:
            node.kind === 'task' && (closed || validHolder || unverifiedHolder) ? linked : null,
          claim:
            node.kind === 'task' && !closed && validHolder && linked
              ? {
                  holderNodeId: linked,
                  leaseId: identifiers.uuid(),
                  acquiredAt: identifiers.now(),
                }
              : null,
          claimNote: null,
          claimGeneration: node.kind === 'task' && !closed && validHolder ? 1 : 0,
          lastRunAt: typeof task.lastRunAt === 'string' ? task.lastRunAt : null,
          agentSessions: Array.isArray(task.agentSessions)
            ? (task.agentSessions as PersistedTaskAgentSessionRecord[])
            : [],
          text: node.kind === 'note' && typeof task.text === 'string' ? task.text : '',
          textVersion: 1,
          legacyConflict:
            node.kind === 'task' && !closed && unverifiedHolder && linked
              ? { holderNodeId: linked, taskNodeIds: [node.id], reason: 'unverified_holder' }
              : null,
        })
      }
      const groups = new Map<string, TaskAuthorityRecord[]>()
      for (const record of records) {
        if (!record.claim) {
          continue
        }
        const holder = record.claim.holderNodeId
        groups.set(holder, [...(groups.get(holder) ?? []), record])
      }
      for (const [holderNodeId, group] of groups) {
        if (group.length < 2) {
          continue
        }
        const taskNodeIds = group.map(r => r.nodeId).sort()
        for (const record of group) {
          record.claim = null
          record.claimGeneration = 0
          record.legacyConflict = { holderNodeId, taskNodeIds, reason: 'duplicate_holder' }
        }
      }
      for (const record of records) {
        saveTaskAuthority(db, record, false)
      }
      projectReverseLinks(db)
      db.prepare(
        "INSERT INTO app_meta (key, value) VALUES ('task_authority_active', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
      ).run()
      return records.length ? advanceTaskRevision(db) : readAppStateRevisionFromDb(db)
    })
    .immediate()
}
