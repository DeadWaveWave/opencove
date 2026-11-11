import type { ManagedClaudeLaunchIntent } from '@shared/contracts/managedClaudeLaunch'
import { supportsManagedClaudeOwnership } from '@shared/sync/managedClaudeWorkerCompatibility'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { translate } from '@app/renderer/i18n'
import { toAppErrorDescriptor } from '@shared/errors/appError'

/** Unknown Workers retain legacy creation; a client declaration alone must not opt them in. */
export async function prepareManagedClaudeCreationIntent(
  intent: ManagedClaudeLaunchIntent | undefined,
): Promise<ManagedClaudeLaunchIntent | undefined> {
  if (!intent) {
    return undefined
  }
  let capabilities: unknown
  const invoke = window.opencoveApi?.controlSurface?.invoke
  if (invoke) {
    try {
      capabilities = await invoke({ kind: 'query', id: 'system.capabilities', payload: {} })
    } catch (error) {
      if (toAppErrorDescriptor(error).code !== 'common.invalid_input') {
        throw error
      }
    }
  }
  if (supportsManagedClaudeOwnership(capabilities)) {
    useAppStore
      .getState()
      .setPersistNotice(previous => (previous?.kind === 'compatibility' ? null : previous))
    return intent
  }
  useAppStore.getState().setPersistNotice({
    tone: 'warning',
    kind: 'compatibility',
    message: translate('messages.managedAgentLegacyWorker'),
  })
  return undefined
}
