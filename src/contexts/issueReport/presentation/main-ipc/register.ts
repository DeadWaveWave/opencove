import { ipcMain } from 'electron'
import type { IpcRegistrationDisposable } from '@app/main/ipc/types'
import { registerHandledIpc } from '@app/main/ipc/handle'
import { IPC_CHANNELS } from '@shared/contracts/ipc'
import type { PrepareIssueReportResult } from '@shared/contracts/dto'
import type { IssueReportService } from '../../infrastructure/main/IssueReportService'
import {
  normalizeOpenIssueReportGithubPayload,
  normalizePrepareIssueReportPayload,
  normalizeShowIssueReportFilePayload,
} from './validate'

export function registerIssueReportIpcHandlers(
  service: IssueReportService,
): IpcRegistrationDisposable {
  registerHandledIpc(
    IPC_CHANNELS.issueReportPrepare,
    async (_event, payload): Promise<PrepareIssueReportResult> =>
      await service.prepare(normalizePrepareIssueReportPayload(payload)),
    { defaultErrorCode: 'issue_report.prepare_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.issueReportOpenGithub,
    async (_event, payload): Promise<void> => {
      const normalized = normalizeOpenIssueReportGithubPayload(payload)
      await service.openGithubIssue(normalized.githubIssueUrl)
    },
    { defaultErrorCode: 'issue_report.open_failed' },
  )

  registerHandledIpc(
    IPC_CHANNELS.issueReportShowFile,
    async (_event, payload): Promise<void> => {
      const normalized = normalizeShowIssueReportFilePayload(payload)
      await service.showReportFile(normalized.reportPath)
    },
    { defaultErrorCode: 'issue_report.show_file_failed' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.issueReportPrepare)
      ipcMain.removeHandler(IPC_CHANNELS.issueReportOpenGithub)
      ipcMain.removeHandler(IPC_CHANNELS.issueReportShowFile)
    },
  }
}
