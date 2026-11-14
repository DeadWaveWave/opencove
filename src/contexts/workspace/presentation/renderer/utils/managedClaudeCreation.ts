// @compat-file managed-claude-worker-support
import type { ManagedClaudeLaunchIntent } from '@shared/contracts/managedClaudeLaunch'
import { negotiateManagedClaudeWorkerSupport } from './managedClaudeWorkerSupport'

/** Unknown Workers retain legacy creation; a client declaration alone must not opt them in. */
export async function prepareManagedClaudeCreationIntent(
  intent: ManagedClaudeLaunchIntent | undefined,
): Promise<ManagedClaudeLaunchIntent | undefined> {
  if (!intent) {
    return undefined
  }
  if (await negotiateManagedClaudeWorkerSupport('legacy-creation')) {
    return intent
  }
  return undefined
}
