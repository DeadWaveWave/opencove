import type { ManagedClaudeLaunchIntent } from '@shared/contracts/managedClaudeLaunch'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { translate } from '@app/renderer/i18n'
import { negotiateManagedClaudeWorkerSupport } from './managedClaudeWorkerSupport'

/** Unknown Workers retain legacy creation; a client declaration alone must not opt them in. */
export async function prepareManagedClaudeCreationIntent(
  intent: ManagedClaudeLaunchIntent | undefined,
): Promise<ManagedClaudeLaunchIntent | undefined> {
  if (!intent) {
    return undefined
  }
  if (await negotiateManagedClaudeWorkerSupport('legacy-creation')) {
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
