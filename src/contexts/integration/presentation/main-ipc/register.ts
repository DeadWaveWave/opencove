import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  ExecuteGitHubPullRequestActionInput,
  ExecuteGitHubPullRequestActionResult,
  GetGitHubPullRequestChecksInput,
  GetGitHubPullRequestChecksResult,
  GetGitHubPullRequestDiffInput,
  GetGitHubPullRequestDiffResult,
  GetGitHubPullRequestInput,
  GetGitHubPullRequestResult,
  ResolveGitHubPullRequestsInput,
  ResolveGitHubPullRequestsResult,
} from '../../../../shared/contracts/dto'
import type { IpcRegistrationDisposable } from '../../../../app/main/ipc/types'
import { registerHandledIpc } from '../../../../app/main/ipc/handle'
import type { ApprovedWorkspaceStore } from '../../../workspace/infrastructure/approval/ApprovedWorkspaceStore'
import { createAppError } from '../../../../shared/errors/appError'
import {
  executeGitHubPullRequestAction,
  getGitHubPullRequest,
  getGitHubPullRequestChecks,
  getGitHubPullRequestDiff,
  resolveGitHubPullRequests,
} from '../../infrastructure/github/GitHubPullRequestGhService'
import {
  normalizeExecuteGitHubPullRequestActionPayload,
  normalizeGetGitHubPullRequestChecksPayload,
  normalizeGetGitHubPullRequestDiffPayload,
  normalizeGetGitHubPullRequestPayload,
  normalizeResolveGitHubPullRequestsPayload,
} from './validate'

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

  registerHandledIpc(
    IPC_CHANNELS.integrationGithubGetPullRequest,
    async (_event, payload: GetGitHubPullRequestInput): Promise<GetGitHubPullRequestResult> => {
      const normalized = normalizeGetGitHubPullRequestPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage:
            'integration:github:get-pull-request repoPath is outside approved workspaces',
        })
      }

      return await getGitHubPullRequest(normalized)
    },
    { defaultErrorCode: 'integration.github.resolve_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.integrationGithubGetPullRequestChecks,
    async (
      _event,
      payload: GetGitHubPullRequestChecksInput,
    ): Promise<GetGitHubPullRequestChecksResult> => {
      const normalized = normalizeGetGitHubPullRequestChecksPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage:
            'integration:github:get-pull-request-checks repoPath is outside approved workspaces',
        })
      }

      return await getGitHubPullRequestChecks(normalized)
    },
    { defaultErrorCode: 'integration.github.resolve_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.integrationGithubGetPullRequestDiff,
    async (
      _event,
      payload: GetGitHubPullRequestDiffInput,
    ): Promise<GetGitHubPullRequestDiffResult> => {
      const normalized = normalizeGetGitHubPullRequestDiffPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage:
            'integration:github:get-pull-request-diff repoPath is outside approved workspaces',
        })
      }

      return await getGitHubPullRequestDiff(normalized)
    },
    { defaultErrorCode: 'integration.github.resolve_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.integrationGithubExecutePullRequestAction,
    async (
      _event,
      payload: ExecuteGitHubPullRequestActionInput,
    ): Promise<ExecuteGitHubPullRequestActionResult> => {
      const normalized = normalizeExecuteGitHubPullRequestActionPayload(payload)
      const isApproved = await approvedWorkspaces.isPathApproved(normalized.repoPath)
      if (!isApproved) {
        throw createAppError('common.approved_path_required', {
          debugMessage:
            'integration:github:execute-pull-request-action repoPath is outside approved workspaces',
        })
      }

      return await executeGitHubPullRequestAction(normalized)
    },
    { defaultErrorCode: 'integration.github.action_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.integrationGithubResolvePullRequests)
      ipcMain.removeHandler(IPC_CHANNELS.integrationGithubGetPullRequest)
      ipcMain.removeHandler(IPC_CHANNELS.integrationGithubGetPullRequestChecks)
      ipcMain.removeHandler(IPC_CHANNELS.integrationGithubGetPullRequestDiff)
      ipcMain.removeHandler(IPC_CHANNELS.integrationGithubExecutePullRequestAction)
    },
  }
}
