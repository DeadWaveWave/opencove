import { WorkspaceBootstrapMutationOwner } from '../../../../contexts/workspace/application/workspaceBootstrapMutationOwner'
import { validateBootstrapSpaceDirectory } from '../../../../contexts/workspace/infrastructure/approval/bootstrapSpaceDirectory'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve, basename } from 'node:path'
import {
  addProject,
  createSpace,
  type WorkspaceBootstrapPorts,
} from '../../../../contexts/workspace/application/workspaceBootstrap'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { normalizePersistedAppState } from '../../../../platform/persistence/sqlite/normalize'
import type { PersistenceStore } from '../../../../platform/persistence/sqlite/PersistenceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { projectAddOperation } from '../../../../shared/contracts/controlSurface/operations/domains/project'
import { spaceCreateOperation } from '../../../../shared/contracts/controlSurface/operations/domains/space'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'
import type { WorkerTopologyStore } from '../topology/topologyStore'

export function registerWorkspaceBootstrapHandlers(
  controlSurface: ControlSurface,
  deps: {
    getPersistenceStore: () => Promise<PersistenceStore>
    topology: WorkerTopologyStore
    approvedWorkspaces: ApprovedWorkspaceStore
  },
) {
  const mutationOwner = new WorkspaceBootstrapMutationOwner()
  async function ports(assertActive?: () => void): Promise<WorkspaceBootstrapPorts> {
    const store = await deps.getPersistenceStore()
    return {
      mutationOwner,
      validateSpaceDirectory: validateBootstrapSpaceDirectory,
      store: {
        readAppState: async () => normalizePersistedAppState(await store.readAppState()),
        readAppStateRevision: store.readAppStateRevision,
        writeAppState: store.writeAppState,
      },
      createId: randomUUID,
      assertActive,
      validateDirectory: async path => {
        if (!isAbsolute(path)) {
          throw createAppError('common.invalid_input', {
            debugMessage: 'path must be absolute and local.',
          })
        }
        let directory = false
        try {
          directory = (await stat(path)).isDirectory()
        } catch {
          throw createAppError('common.invalid_input', {
            debugMessage: 'path does not exist or is inaccessible.',
          })
        }
        if (!directory) {
          throw createAppError('common.invalid_input', { debugMessage: 'path is not a directory.' })
        }
        return resolve(path)
      },
      approveRoot: path => deps.approvedWorkspaces.registerRoot(path),
      listMounts: async projectId =>
        (await deps.topology.listMounts({ projectId })).mounts.sort(
          (a, b) => a.sortOrder - b.sortOrder,
        ),
      createMount: async (projectId, rootPath) =>
        (
          await deps.topology.createMount({
            projectId,
            rootPath,
            endpointId: 'local',
            name: basename(rootPath),
          })
        ).mount,
    }
  }
  registerOperation(controlSurface, projectAddOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) => addProject(await ports(ctx.assertActive), input),
  })
  registerOperation(controlSurface, spaceCreateOperation, {
    defaultErrorCode: 'common.unexpected',
    handle: async (ctx, input) => createSpace(await ports(ctx.assertActive), input),
  })
}
