export const ISSUE_REPORT_KINDS = ['run_agent_failed', 'app_error', 'other'] as const

export type IssueReportKind = (typeof ISSUE_REPORT_KINDS)[number]

export interface IssueReportContextInput {
  activeWorkspaceName?: string | null
  activeWorkspacePath?: string | null
  activeSpaceName?: string | null
  activeSpacePath?: string | null
}

export interface IssueReportUiGeometryInput {
  window: {
    innerWidth: number | null
    innerHeight: number | null
    outerWidth: number | null
    outerHeight: number | null
    devicePixelRatio: number | null
    visualViewportScale: number | null
  }
  canvas: {
    rect: { x: number; y: number; width: number; height: number } | null
    viewport: { x: number; y: number; zoom: number } | null
  }
  nodes: Array<{
    id: string
    kind: string | null
    x: number
    y: number
    width: number
    height: number
  }>
  browserWindow?: {
    bounds: { x: number; y: number; width: number; height: number }
    contentBounds: { x: number; y: number; width: number; height: number }
    zoomFactor: number
    maximized: boolean
    fullscreen: boolean
  } | null
}

export interface PrepareIssueReportInput {
  kind: IssueReportKind
  title?: string | null
  description?: string | null
  includeLocalPaths?: boolean | null
  context?: IssueReportContextInput | null
  uiGeometry?: IssueReportUiGeometryInput | null
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
