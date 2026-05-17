import { app, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import type {
  AppUpdateState,
  PrepareIssueReportInput,
  PrepareIssueReportResult,
} from '@shared/contracts/dto'
import { createAppError } from '@shared/errors/appError'
import type { PersistenceStore } from '@platform/persistence/sqlite/PersistenceStore'
import type { ControlSurfaceRemoteEndpointResolver } from '@app/main/controlSurface/remote/controlSurfaceHttpClient'
import {
  buildGitHubIssueUrl,
  buildIssueReportDocument,
  defaultIssueReportTitle,
  resolveIncludedDiagnostics,
} from '../../application/IssueReportDocument'
import {
  collectIssueReportDiagnosticSections,
  collectIssueReportKnownPaths,
  readIssueReportPersistedState,
} from './issueReportDiagnostics'

const ISSUE_REPORTS_DIR = 'issue-reports'

export interface IssueReportService {
  prepare(input: PrepareIssueReportInput): Promise<PrepareIssueReportResult>
  openGithubIssue(githubIssueUrl: string): Promise<void>
  showReportFile(reportPath: string): Promise<void>
}

export function createIssueReportService(deps: {
  getUpdateState: () => AppUpdateState
  getPersistenceStore: () => Promise<PersistenceStore>
  workerEndpointResolver?: ControlSurfaceRemoteEndpointResolver | null
}): IssueReportService {
  const userDataPath = app.getPath('userData')
  const issueReportsDir = resolve(userDataPath, ISSUE_REPORTS_DIR)

  const isReportPathOwnedByApp = (reportPath: string): boolean => {
    const resolved = resolve(reportPath)
    const rel = relative(issueReportsDir, resolved)
    return rel.length > 0 && !rel.startsWith('..') && !rel.includes(':')
  }

  const prepare = async (input: PrepareIssueReportInput): Promise<PrepareIssueReportResult> => {
    const createdAt = new Date().toISOString()
    const reportId = createdAt.replace(/[:.]/g, '-')
    const fileName = `opencove-issue-report-${reportId}.md`
    const reportPath = resolve(issueReportsDir, fileName)
    const includeLocalPaths = input.includeLocalPaths === true
    const title = input.title?.trim() || defaultIssueReportTitle(input.kind)
    const description = input.description?.trim() ?? ''
    const persistedState = await readIssueReportPersistedState(deps.getPersistenceStore)
    const sections = await collectIssueReportDiagnosticSections({
      input,
      reportId,
      createdAt,
      userDataPath,
      persistedState,
      getUpdateState: deps.getUpdateState,
      workerEndpointResolver: deps.workerEndpointResolver,
    })
    const knownPathsToRedact = includeLocalPaths
      ? []
      : collectIssueReportKnownPaths({ input, persistedState, userDataPath })
    const document = buildIssueReportDocument({
      reportId,
      createdAt,
      request: {
        kind: input.kind,
        title,
        description,
        includeLocalPaths,
        context: input.context ?? null,
      },
      sections,
      knownPathsToRedact,
    })
    const githubIssueUrl = buildGitHubIssueUrl({
      title,
      body: document.githubBody,
    })

    await mkdir(issueReportsDir, { recursive: true })
    await writeFile(reportPath, document.markdown, { encoding: 'utf8', mode: 0o600 })

    return {
      reportId,
      createdAt,
      reportPath,
      markdown: document.markdown,
      githubIssueUrl,
      includedDiagnostics: resolveIncludedDiagnostics(includeLocalPaths),
    }
  }

  const openGithubIssue = async (githubIssueUrl: string): Promise<void> => {
    const parsed = new URL(githubIssueUrl)
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      parsed.pathname !== '/DeadWaveWave/opencove/issues/new'
    ) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid GitHub issue URL.' })
    }

    await shell.openExternal(parsed.toString())
  }

  const showReportFile = async (reportPath: string): Promise<void> => {
    if (!isReportPathOwnedByApp(reportPath) || basename(reportPath).endsWith('.md') === false) {
      throw createAppError('common.invalid_input', { debugMessage: 'Invalid issue report path.' })
    }

    shell.showItemInFolder(resolve(reportPath))
  }

  return {
    prepare,
    openGithubIssue,
    showReportFile,
  }
}
