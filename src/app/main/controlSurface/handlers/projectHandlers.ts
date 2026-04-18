import type { ControlSurface } from '../controlSurface'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { ListProjectsResult } from '../../../../shared/contracts/dto'

export function registerProjectHandlers(
  controlSurface: ControlSurface,
  getPersistenceStore: () => Promise<PersistenceStore>,
): void {
  controlSurface.register('project.list', {
    kind: 'query',
    validate: payload => payload ?? null,
    handle: async (): Promise<ListProjectsResult> => {
      const store = await getPersistenceStore()
      const normalized = normalizePersistedAppState(await store.readAppState())
      const workspaces = normalized?.workspaces ?? []

      return {
        activeProjectId: normalized?.activeWorkspaceId ?? null,
        projects: workspaces.map(workspace => ({
          id: workspace.id,
          name: workspace.name,
          path: workspace.path,
          worktreesRoot: workspace.worktreesRoot,
          activeSpaceId: workspace.activeSpaceId,
        })),
      }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
