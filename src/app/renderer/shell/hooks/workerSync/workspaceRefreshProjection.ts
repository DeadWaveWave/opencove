import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import { reconcileCanonicalPublication } from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'

/** Connect reconciliation rebases workspace/settings intent; node and membership guards
 * remain owned by the normal sync projection, rather than merging their deltas twice. */
export function rebaseConnectMetadata(
  canonical: PersistedAppState,
  current: PersistedAppState,
): PersistedAppState {
  const rebased = reconcileCanonicalPublication(canonical, current)
  return {
    ...rebased,
    workspaces: rebased.workspaces.map(workspace => {
      const latest = canonical.workspaces.find(candidate => candidate.id === workspace.id)
      return latest
        ? {
            ...workspace,
            nodes: latest.nodes,
            spaces: workspace.spaces.map(space => ({
              ...space,
              nodeIds:
                latest.spaces.find(candidate => candidate.id === space.id)?.nodeIds ??
                space.nodeIds,
            })),
          }
        : workspace
    }),
  }
}
