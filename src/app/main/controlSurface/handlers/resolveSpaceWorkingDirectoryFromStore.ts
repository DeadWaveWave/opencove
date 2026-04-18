import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import { resolveSpaceWorkingDirectory } from '../../../../contexts/space/application/resolveSpaceWorkingDirectory'
import { normalizeAgentSettings } from '../../../../contexts/settings/domain/agentSettings'
import { createAppError } from '../../../../shared/errors/appError'

export async function resolveSpaceWorkingDirectoryFromStore(options: {
  spaceId: string
  getPersistenceStore: () => Promise<PersistenceStore>
}): Promise<{
  projectId: string
  workspacePath: string
  workingDirectory: string
  agentSettings: ReturnType<typeof normalizeAgentSettings>
}> {
  const store = await options.getPersistenceStore()
  const normalized = normalizePersistedAppState(await store.readAppState())
  const workspaces = normalized?.workspaces ?? []

  for (const workspace of workspaces) {
    const space = workspace.spaces.find(candidate => candidate.id === options.spaceId) ?? null
    if (!space) {
      continue
    }

    return {
      projectId: workspace.id,
      workspacePath: workspace.path,
      workingDirectory: resolveSpaceWorkingDirectory(space, workspace.path),
      agentSettings: normalizeAgentSettings(normalized?.settings),
    }
  }

  throw createAppError('space.not_found', {
    debugMessage: `Unknown space id: ${options.spaceId}`,
  })
}
