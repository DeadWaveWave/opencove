import { translate } from '@app/renderer/i18n'
import { useAppStore } from '../../store/useAppStore'
import { acceptPersistedStateSnapshot } from '@contexts/workspace/presentation/renderer/utils/persistence/accept'
import type { PersistedStateReadResult } from '@contexts/workspace/presentation/renderer/utils/persistence/read'
import {
  isPublicationBlocked,
  recordPublicationPresentation,
  getPendingPublication,
} from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { toPersistedState } from '@contexts/workspace/presentation/renderer/utils/persistence/toPersistedState'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
/** Acknowledge canonical content, apply rebased disclosure, then record the actual presentation. */
export function acceptWorkerSyncSnapshot(
  snapshot: PersistedStateReadResult,
  presentation: PersistedAppState,
): void {
  acceptPersistedStateSnapshot(snapshot, presentation)
  const state = useAppStore.getState()
  recordPublicationPresentation(
    toPersistedState(state.workspaces, state.activeWorkspaceId, state.agentSettings),
  )
  if (isPublicationBlocked()) {
    state.setPersistNotice({
      tone: 'warning',
      kind: 'write',
      message: translate(
        getPendingPublication()?.blockedReason === 'conflict'
          ? 'persistence.saveConflict'
          : 'persistence.saveUnconfirmed',
      ),
    })
  }
}
