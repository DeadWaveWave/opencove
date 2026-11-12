import type Database from 'better-sqlite3'
import { canonicalContent } from '../../../shared/sync/mergeValue'
import {
  projectTaskAuthorityRecord,
  stripUnownedTaskFields,
  taskObject,
} from '../../../shared/sync/taskAuthorityProjection'
import type { NormalizedPersistedAppState, NormalizedPersistedNode } from './normalize'
import { createAppError } from '../../../shared/errors/appError'
import { readAllTaskAuthority } from './taskAuthorityRead'

function ownedIdentityConflict(nodeId: string, field: string, reason = 'incompatible'): never {
  throw createAppError('persistence.owned_node_identity_conflict', {
    details: { nodeId, field, reason, authority: 'task' },
  })
}

/** Every snapshot writer, including raw, reaches this gate inside its transaction. */
export function enforceTaskAuthority(
  db: Database.Database,
  state: NormalizedPersistedAppState,
): {
  effectiveState: NormalizedPersistedAppState
  corrected: boolean
} {
  const records = readAllTaskAuthority(db)
  const active = !!db
    .prepare("SELECT 1 FROM app_meta WHERE key = 'task_authority_active' AND value = '1'")
    .get()
  const hasUnsupportedFields = state.workspaces.some(workspace =>
    workspace.nodes.some(
      node =>
        (node.kind === 'task' || node.kind === 'note') &&
        stripUnownedTaskFields(node.task) !== node.task,
    ),
  )
  if (!records.length && !active && !hasUnsupportedFields) {
    return { effectiveState: state, corrected: false }
  }
  const proposed = new Map<string, { node: NormalizedPersistedNode; projectId: string }>()
  for (const workspace of state.workspaces) {
    for (const node of workspace.nodes) {
      if (proposed.has(node.id)) {
        ownedIdentityConflict(node.id, 'id', 'duplicate')
      }
      proposed.set(node.id, { node, projectId: workspace.id })
    }
  }
  const byId = new Map(records.map(record => [record.nodeId, record]))
  for (const record of records) {
    const candidate = proposed.get(record.nodeId)
    if (record.retired) {
      if (candidate) {
        ownedIdentityConflict(record.nodeId, 'id', 'retired')
      }
      continue
    }
    if (!candidate) {
      ownedIdentityConflict(record.nodeId, 'id', 'missing')
    }
    if (candidate.projectId !== record.projectId) {
      ownedIdentityConflict(record.nodeId, 'projectId')
    }
    if (candidate.node.kind !== record.kind) {
      ownedIdentityConflict(record.nodeId, 'kind')
    }
  }
  const holders = db.prepare('SELECT * FROM task_claim_holders').all() as {
    node_id: string
    project_id: string
    kind: string
    session_id: string | null
    worker_binding_json: string | null
  }[]
  for (const holder of holders) {
    const candidate = proposed.get(holder.node_id)
    if (!candidate) {
      ownedIdentityConflict(holder.node_id, 'id', 'claimed_holder_missing')
    }
    const node = candidate.node
    if (
      candidate.projectId !== holder.project_id ||
      node.kind !== holder.kind ||
      node.sessionId !== holder.session_id ||
      canonicalContent(node.workerBinding) !==
        canonicalContent(holder.worker_binding_json ? JSON.parse(holder.worker_binding_json) : null)
    ) {
      ownedIdentityConflict(holder.node_id, 'holderIdentity')
    }
  }
  const openByHolder = new Map(
    records.filter(r => !r.retired && r.claim).map(r => [r.claim!.holderNodeId, r.nodeId]),
  )
  const ownedProjects = new Set(records.map(r => r.projectId))
  let corrected = false
  const effectiveState = {
    ...state,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes.map(node => {
        const record = byId.get(node.id)
        if (active && (node.kind === 'task' || node.kind === 'note') && !record) {
          ownedIdentityConflict(node.id, 'id', 'unregistered')
        }
        let next =
          node.kind === 'task' || node.kind === 'note'
            ? { ...node, task: stripUnownedTaskFields(node.task) }
            : node
        if (record) {
          next = { ...node, task: projectTaskAuthorityRecord(record, node.task) }
        }
        // Reverse links are compatibility projections, never deletion or claim authority.
        if (node.kind === 'agent' && ownedProjects.has(workspace.id)) {
          next = {
            ...next,
            agent: { ...taskObject(next.agent), taskId: openByHolder.get(node.id) ?? null },
          }
        }
        if (canonicalContent(next) !== canonicalContent(node)) {
          corrected = true
        }
        return next
      }),
    })),
  }
  return { effectiveState: corrected ? effectiveState : state, corrected }
}
