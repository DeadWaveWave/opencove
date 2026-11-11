import { canAcceptCanonicalState } from './publicationState'
import type { PersistedStateReadResult } from './read'
import { useCanvasCollapseStore } from '../../store/useCanvasCollapseStore'
import { canvasCollapseFromPersistedLists, EMPTY_CANVAS_COLLAPSE } from '../canvasCollapse'
import { markPersistedStateAsSynced } from './write'

/** Publish a snapshot only after its lifecycle and local-edit guards accept it. */
export function acceptPersistedStateSnapshot(
  {
    state,
    isPersisted,
    revision,
  }: Pick<PersistedStateReadResult, 'state' | 'isPersisted' | 'revision'>,
  presentation = state,
): void {
  if (!state || (isPersisted && !canAcceptCanonicalState(state, revision))) {
    return
  }
  for (const workspace of (presentation ?? state).workspaces) {
    if (workspace.collapsedNodeIds === undefined && workspace.collapsedSpaceIds === undefined) {
      continue
    }

    useCanvasCollapseStore
      .getState()
      .hydrate(
        workspace.id,
        canvasCollapseFromPersistedLists(workspace.collapsedNodeIds, workspace.collapsedSpaceIds) ??
          EMPTY_CANVAS_COLLAPSE,
      )
  }
  // Restoring readable legacy data does not acknowledge a failed migration.
  // Leave the write cache untouched so the next publication retries durable IO.
  if (isPersisted) {
    markPersistedStateAsSynced(state, revision)
  }
}
