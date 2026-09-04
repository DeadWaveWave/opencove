import type { TerminalRuntimeAvailability } from '../../../../contexts/terminal/application/TerminalRuntimeAvailability'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { toAppErrorDescriptor } from '../../../../shared/errors/appError'

export async function initializeTerminalRuntimeAvailability(options: {
  getPersistenceStore: () => Promise<PersistenceStore>
  availability: TerminalRuntimeAvailability
}): Promise<void> {
  try {
    const store = await options.getPersistenceStore()
    const state = normalizePersistedAppState(await store.readAppState())
    const recoveryWorkspaceIds = (state?.workspaces ?? [])
      .filter(workspace =>
        workspace.nodes.some(node => node.kind === 'terminal' || node.kind === 'agent'),
      )
      .map(workspace => workspace.id)
    options.availability.completeStartup(recoveryWorkspaceIds)
  } catch (error) {
    options.availability.failStartup()
    const detail = toAppErrorDescriptor(error).debugMessage ?? String(error)
    process.stderr.write(`[opencove] terminal runtime admission unavailable: ${detail}\n`)
  }
}
