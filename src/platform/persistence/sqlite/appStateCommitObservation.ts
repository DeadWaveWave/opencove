import type Database from 'better-sqlite3'
import type { AppStateCommittedObservation } from '../../../shared/contracts/managedClaudeLaunch'

/** Local write-boundary helper; raw writes invoke publish only after their outer transaction. */
export function createAppStateCommitObservation(db: Database.Database) {
  const listeners = new Set<(event: AppStateCommittedObservation) => void>()
  const capture = () =>
    db
      .prepare(
        'SELECT id, session_id, EXISTS (SELECT 1 FROM managed_claude_resume_bindings WHERE node_id = nodes.id) AS managed FROM nodes',
      )
      .all() as {
      id: string
      session_id: string | null
      managed: number
    }[]
  return {
    capture,
    subscribe: (listener: (event: AppStateCommittedObservation) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    describe: (
      before: ReturnType<typeof capture>,
      revision: number,
    ): AppStateCommittedObservation | null => {
      const after = new Set(capture().map(node => node.id))
      const removed = before.filter(node => !after.has(node.id))
      if (!removed.length) {
        return null
      }
      return {
        revision,
        removedManagedRuntimeSessionIds: [
          ...new Set(
            removed.flatMap(node => (node.managed && node.session_id ? [node.session_id] : [])),
          ),
        ],
        removedNodeIds: removed.map(node => node.id),
        removedRuntimeSessionIds: [
          ...new Set(removed.flatMap(node => (node.session_id ? [node.session_id] : []))),
        ],
      }
    },
    publish: (event: AppStateCommittedObservation | null) => {
      if (!event) {
        return
      }
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          /* Observers cannot change an already committed result. */
        }
      }
    },
  }
}
