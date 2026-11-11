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
  const capabilities = await readManagedClaudeWorkerCapabilities()
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
