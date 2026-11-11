import { translate } from '@app/renderer/i18n'
import { persistenceScope } from './persistence/publicationState'
import {
  updateManagedClaudeCompatibilityNotice,
  expireManagedClaudeCompatibilityNotice,
} from './managedClaudeCompatibilityNotice'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import {
  assertManagedClaudeWorkerCompatible,
  supportsManagedClaudeOwnership,
} from '@shared/sync/managedClaudeWorkerCompatibility'

/** Query at interaction start: a client declaration cannot establish Worker support. */
async function readManagedClaudeWorkerCapabilities(): Promise<unknown> {
  const invoke = window.opencoveApi?.controlSurface?.invoke
  if (!invoke) {
    return undefined
  }
  try {
    return await invoke({ kind: 'query', id: 'system.capabilities', payload: {} })
  } catch (error) {
    if (toAppErrorDescriptor(error).code !== 'common.invalid_input') {
      throw error
    }
    return undefined
  }
}

/** Only fresh creation can safely fall back by omitting managed intent. */
export async function negotiateManagedClaudeWorkerSupport(
  policy: 'legacy-creation' | 'required',
): Promise<boolean> {
  const scope = persistenceScope()
  expireManagedClaudeCompatibilityNotice(scope)
  const capabilities = await readManagedClaudeWorkerCapabilities()
  const compatible = supportsManagedClaudeOwnership(capabilities)
  const features = (
    capabilities as { features?: { managedClaudeResumeBindingWritesEnabled?: boolean } } | undefined
  )?.features
  if (!compatible || features?.managedClaudeResumeBindingWritesEnabled === false) {
    updateManagedClaudeCompatibilityNotice(scope, {
      tone: 'warning',
      kind: 'compatibility',
      message: translate(
        compatible ? 'messages.managedAgentWritesDisabled' : 'messages.managedAgentLegacyWorker',
      ),
    })
  } else if (features?.managedClaudeResumeBindingWritesEnabled === true) {
    updateManagedClaudeCompatibilityNotice(scope, null)
  }
  if (policy === 'required') {
    assertManagedClaudeWorkerCompatible(capabilities)
  }
  return supportsManagedClaudeOwnership(capabilities)
}

/** Call before any lifecycle effect that can adopt or mutate a Claude node. */
export async function requireManagedClaudeWorkerSupport(provider?: string): Promise<void> {
  if (provider === 'claude-code') {
    await negotiateManagedClaudeWorkerSupport('required')
  }
}
