import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import type {
  OpenIssueReportGithubInput,
  PrepareIssueReportInput,
  PrepareIssueReportResult,
  ShowIssueReportFileInput,
} from '../../shared/contracts/dto'
import { invokeIpc } from './ipcInvoke'

export function createIssueReportPreloadApi(): {
  prepare: (payload: PrepareIssueReportInput) => Promise<PrepareIssueReportResult>
  openGitHubIssue: (payload: OpenIssueReportGithubInput) => Promise<void>
  showReportFile: (payload: ShowIssueReportFileInput) => Promise<void>
} {
  return {
    prepare: (payload: PrepareIssueReportInput): Promise<PrepareIssueReportResult> =>
      invokeIpc(IPC_CHANNELS.issueReportPrepare, payload),
    openGitHubIssue: (payload: OpenIssueReportGithubInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.issueReportOpenGithub, payload),
    showReportFile: (payload: ShowIssueReportFileInput): Promise<void> =>
      invokeIpc(IPC_CHANNELS.issueReportShowFile, payload),
  }
}
