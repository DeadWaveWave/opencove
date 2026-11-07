import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  workspaceAllocateProjectPlaceholderOperation,
  workspaceApproveRootOperation,
  workspaceEnsureDirectoryOperation,
} from '../../../../shared/contracts/controlSurface/operations/domains/workspace'
import { createAppError } from '../../../../shared/errors/appError'
import type { ControlSurface } from '../controlSurface'
import { registerOperation } from '../registerOperation'

export function registerWorkspaceHandlers(
  controlSurface: ControlSurface,
  deps: { approvedWorkspaces: ApprovedWorkspaceStore; userDataPath: string },
): void {
  registerOperation(controlSurface, workspaceApproveRootOperation, {
    handle: async (_ctx, payload): Promise<void> => {
      await deps.approvedWorkspaces.registerRoot(payload.path)
    },
    defaultErrorCode: 'common.unexpected',
  })

  registerOperation(controlSurface, workspaceEnsureDirectoryOperation, {
    handle: async (_ctx, payload): Promise<void> => {
      const isApproved = await deps.approvedWorkspaces.isPathApproved(payload.path)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'workspace.ensureDirectory path is outside approved roots',
        })
      }

      await mkdir(payload.path, { recursive: true })
    },
    defaultErrorCode: 'workspace.ensure_directory_failed',
  })

  registerOperation(controlSurface, workspaceAllocateProjectPlaceholderOperation, {
    handle: async (_ctx, payload): Promise<{ path: string }> => {
      const placeholderPath = resolve(deps.userDataPath, 'projects', payload.projectId)
      await mkdir(placeholderPath, { recursive: true })
      await deps.approvedWorkspaces.registerRoot(placeholderPath)
      return { path: placeholderPath }
    },
    defaultErrorCode: 'common.unexpected',
  })
}
