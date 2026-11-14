import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import {
  reorderRootSpacesWithinPinGroup,
  setRootSpacePinned,
} from '@contexts/workspace/domain/workspaceSpacePinning'
import { canonicalizePersistedAppState } from '@shared/sync/canonicalizePersistedAppState'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import type { Client } from './client'
import { sqliteWireState } from './sqliteWire'
export function editSpaceOrder(client: Client, pin: boolean) {
  client.server.model.edit('spaceOrder', 'second,space')
  if (pin) {
    client.server.model.edit('spacePinned', true)
  }
  useAppStore.setState(state => ({
    workspaces: (ws =>
      ws.map(w => ({
        ...w,
        spaces: pin
          ? setRootSpacePinned(w.spaces, 'second', true)
          : reorderRootSpacesWithinPinGroup(w.spaces, 'second', 'space'),
      })))(state.workspaces),
  }))
}
/** Check the cache's canonical representation against the actual SQLite reader, not array position in UI. */
export function assertCanonicalSpaceOrder(cached: PersistedAppState | null | undefined) {
  if (!cached) {
    return
  }
  const ordered = (s: { workspaces: Array<{ spaces: Array<{ id: string }> }> }) =>
    s.workspaces.map(w => w.spaces.map(space => space.id))
  const normalized = canonicalizePersistedAppState(cached, normalizeAgentSettings)!
  if (JSON.stringify(ordered(normalized)) !== JSON.stringify(ordered(sqliteWireState(cached)))) {
    throw new Error('I11: canonical Space order differs from SQLite read order')
  }
}
