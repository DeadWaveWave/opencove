import type Database from 'better-sqlite3'
import { createAppError } from '../../../shared/errors/appError'

/** Trusted runtime owner only: join its existing transaction, never start another one. */
export function rebindTaskClaimHolderRuntime(
  db: Database.Database,
  nodeId: string,
  expectedSessionId: string | null,
  nextSessionId: string | null,
): void {
  if (!db.inTransaction) {
    throw createAppError('persistence.unavailable')
  }
  if (
    db
      .prepare('SELECT 1 FROM task_claim_holders WHERE node_id = ? AND session_id IS NOT ?')
      .get(nodeId, expectedSessionId)
  ) {
    throw createAppError('persistence.owned_node_identity_conflict', {
      details: { nodeId, field: 'holderIdentity', authority: 'task' },
    })
  }
  if (nextSessionId !== expectedSessionId) {
    db.prepare('UPDATE task_claim_holders SET session_id = ? WHERE node_id = ?').run(
      nextSessionId,
      nodeId,
    )
  }
}
