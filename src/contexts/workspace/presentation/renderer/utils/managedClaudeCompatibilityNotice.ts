// @compat-file managed-claude-worker-support
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { PersistNotice } from '@app/renderer/shell/types'
import { persistenceScope } from './persistence/publicationState'

/** Keep the reason independently while a connection/recovery/write notice covers it. */
export function currentManagedClaudeCompatibilityNotice(): PersistNotice | null {
  const retained = useAppStore.getState().managedClaudeCompatibilityNotice
  return retained?.scope === persistenceScope() ? retained.notice : null
}
export function updateManagedClaudeCompatibilityNotice(
  scope: number,
  notice: PersistNotice | null,
): void {
  if (scope !== persistenceScope()) {
    return
  }
  useAppStore.setState(state => ({
    managedClaudeCompatibilityNotice: notice ? { scope, notice } : null,
    persistNotice:
      state.persistNotice && state.persistNotice.kind !== 'compatibility'
        ? state.persistNotice
        : notice,
  }))
}

export function expireManagedClaudeCompatibilityNotice(scope: number): void {
  const retained = useAppStore.getState().managedClaudeCompatibilityNotice
  if (retained && retained.scope !== scope) {
    updateManagedClaudeCompatibilityNotice(scope, null)
  }
}
