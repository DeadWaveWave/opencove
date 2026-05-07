export const ISSUE_REPORT_KINDS = ['run_agent_failed', 'app_error', 'other'] as const

export type IssueReportKind = (typeof ISSUE_REPORT_KINDS)[number]

export interface IssueReportContextInput {
  activeWorkspaceName?: string | null
  activeWorkspacePath?: string | null
  activeSpaceName?: string | null
  activeSpacePath?: string | null
}

export interface PrepareIssueReportInput {
  kind: IssueReportKind
  title?: string | null
  description?: string | null
  includeLocalPaths?: boolean | null
  context?: IssueReportContextInput | null
}

export interface IssueReportIncludedDiagnostics {
  system: boolean
  worker: boolean
  agent: boolean
  logs: boolean
  localPaths: boolean
}

export interface PrepareIssueReportResult {
  reportId: string
  createdAt: string
  reportPath: string
  markdown: string
  githubIssueUrl: string
  includedDiagnostics: IssueReportIncludedDiagnostics
}

export interface OpenIssueReportGithubInput {
  githubIssueUrl: string
}

export interface ShowIssueReportFileInput {
  reportPath: string
}
