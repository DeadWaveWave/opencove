import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  SuggestTaskTitleInput,
  SuggestTaskTitleResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import { suggestTaskTitle } from '../../infrastructure/cli/TaskTitleGenerator'
import type { ApprovedWorkspaceStore } from '../../../../contexts/workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { normalizeSuggestTaskTitlePayload } from './validate'
import { createAppError } from '../../../../shared/errors/appError'

export function registerTaskIpcHandlers(
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.taskSuggestTitle,
    async (_event, payload: SuggestTaskTitleInput): Promise<SuggestTaskTitleResult> => {
      const normalized = normalizeSuggestTaskTitlePayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.cwd)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage: 'task:suggest-title cwd is outside approved workspaces',
        })
      }
      return await suggestTaskTitle(normalized)
    },
    { defaultErrorCode: 'task.suggest_title_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.taskSuggestTitle)
    },
  }
}
