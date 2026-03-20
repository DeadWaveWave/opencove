import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  ResolveGitHubPullRequestsInput,
  ResolveGitHubPullRequestsResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../../workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import { resolveGitHubPullRequests } from '../../infrastructure/github/GitHubPullRequestGhService'
import { normalizeResolveGitHubPullRequestsPayload } from './validate'

export function registerIntegrationIpcHandlers(
  approvedWorkspaces: ApprovedWorkspaceStore,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.integrationGithubResolvePullRequests,
    async (
      _event,
      payload: ResolveGitHubPullRequestsInput,
    ): Promise<ResolveGitHubPullRequestsResult> => {
      const normalized = normalizeResolveGitHubPullRequestsPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage:
            'integration:github:resolve-pull-requests repoPath is outside approved workspaces',
        })
      }

      return await resolveGitHubPullRequests(normalized)
    },
    { defaultErrorCode: 'integration.github.resolve_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.integrationGithubResolvePullRequests)
    },
  }
}
