import { normalizePersistedAppState as normalizeStorage } from './persistedAppStateStorage'
import {
  normalizePersistedAppStateForMerge,
  type PersistedSettingsNormalizer,
} from './normalizePersistedAppStateForMerge'

interface OrderedSpace {
  id: string
  sortOrder?: number
  parentSpaceId?: string | null
}
/** SQLite reads Spaces by sortOrder; ties and unordered node rows need a stable identity order. */
export function orderPersistedSpaces<T extends OrderedSpace>(spaces: readonly T[]): T[] {
  return spaces
    .map((space, index) => ({ space, order: space.sortOrder ?? index }))
    .sort((a, b) => a.order - b.order || compareId(a.space, b.space))
    .map(({ space }) => space)
}
function compareId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
interface ViewState {
  activeWorkspaceId: string | null
  workspaces: Array<{
    id: string
    spaces: OrderedSpace[]
    viewport?: unknown
    isMinimapVisible?: boolean
    activeSpaceId?: string | null
  }>
}
/** Normalize order before choosing the shared placeholder; real selection stays client-local. */
export function stripPersistedAppViewState<T extends ViewState>(state: T): T {
  return {
    ...state,
    activeWorkspaceId: state.workspaces[0]?.id ?? null,
    workspaces: state.workspaces.map(workspace => {
      const spaces = orderPersistedSpaces(workspace.spaces)
      return {
        ...workspace,
        spaces,
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        activeSpaceId: spaces.find(space => !space.parentSpaceId)?.id ?? null,
      }
    }),
  }
}
/** One shared representation for adapter ancestry and renderer content comparisons.
 * Preserve semantic workspace/link/JSON-array order; normalize storage defaults before comparison. */
export function canonicalizePersistedAppState<TSettings extends object>(
  value: unknown,
  normalizeSettings: PersistedSettingsNormalizer<TSettings>,
  options: { preserveNodeOrder?: boolean } = {},
) {
  const prepared = normalizePersistedAppStateForMerge(value, normalizeSettings)
  if (!prepared) {
    return null
  }
  const normalized = normalizePersistedAppStateForMerge(
    normalizeStorage(prepared),
    normalizeSettings,
  )
  if (!normalized) {
    return null
  }
  const state = {
    ...normalized,
    workspaces: normalized.workspaces.map(workspace => ({
      ...workspace,
      nodes: workspace.nodes
        .map(node => ({ ...node, scrollback: null }))
        .sort(options.preserveNodeOrder ? () => 0 : compareId),
      spaces: orderPersistedSpaces(workspace.spaces),
      collapsedNodeIds: [...new Set(workspace.collapsedNodeIds ?? [])].sort(),
      collapsedSpaceIds: [...new Set(workspace.collapsedSpaceIds ?? [])].sort(),
    })),
  }
  return stripPersistedAppViewState(state)
}
