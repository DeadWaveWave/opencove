import type {
  AppUpdateState,
  PerformanceDiagnosticsSnapshotResult,
  PrepareIssueReportInput,
} from '@shared/contracts/dto'
import type { IssueReportDiagnosticSection, IssueReportLogExcerpt } from './IssueReportDocument'

export function createJsonIssueReportSection(
  id: string,
  title: string,
  content: unknown,
  options: {
    summary?: string | null
    github?: IssueReportDiagnosticSection['github']
    sensitivity?: IssueReportDiagnosticSection['sensitivity']
  } = {},
): IssueReportDiagnosticSection {
  return {
    id,
    title,
    status: 'available',
    sensitivity: options.sensitivity ?? 'redacted',
    github: options.github ?? 'summary',
    contentKind: 'json',
    summary: options.summary ?? null,
    content,
  }
}

export function createUnavailableIssueReportSection(
  id: string,
  title: string,
  error: unknown,
  options: {
    github?: IssueReportDiagnosticSection['github']
    sensitivity?: IssueReportDiagnosticSection['sensitivity']
  } = {},
): IssueReportDiagnosticSection {
  return {
    id,
    title,
    status: 'unavailable',
    sensitivity: options.sensitivity ?? 'redacted',
    github: options.github ?? 'summary',
    contentKind: 'text',
    summary: 'Unavailable.',
    content: '',
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }
}

export function createReportMetadataSection(input: {
  request: PrepareIssueReportInput
  reportId: string
  createdAt: string
  logTailBytes: number
  logFileNames: readonly string[]
}): IssueReportDiagnosticSection {
  return createJsonIssueReportSection(
    'report_meta',
    'Report Metadata',
    {
      reportId: input.reportId,
      createdAt: input.createdAt,
      kind: input.request.kind,
      fullReportLogTailBytes: input.logTailBytes,
      logFiles: input.logFileNames,
    },
    {
      summary: `Report ${input.reportId} generated at ${input.createdAt}.`,
      sensitivity: 'safe',
    },
  )
}

export function createAppRuntimeSection(input: {
  version: string
  isPackaged: boolean
  platform: string
  arch: string
  pid: number
  locale: string | null
  timezone: string | null
  electronVersion: string | undefined
  chromeVersion: string | undefined
  nodeVersion: string
}): IssueReportDiagnosticSection {
  return createJsonIssueReportSection(
    'app_runtime',
    'App Runtime',
    {
      version: input.version,
      isPackaged: input.isPackaged,
      platform: input.platform,
      arch: input.arch,
      pid: input.pid,
      locale: input.locale,
      timezone: input.timezone,
      versions: {
        electron: input.electronVersion,
        chrome: input.chromeVersion,
        node: input.nodeVersion,
      },
    },
    {
      summary: `OpenCove ${input.version} on ${input.platform}/${input.arch}.`,
      sensitivity: 'safe',
    },
  )
}

export function createUpdateStateSection(state: AppUpdateState): IssueReportDiagnosticSection {
  return createJsonIssueReportSection('update_state', 'Update State', state, {
    summary: 'Current app update state.',
    sensitivity: 'safe',
  })
}

export function createWorkerStateSection(worker: {
  mode: string
  endpointAvailable: boolean
  [key: string]: unknown
}): IssueReportDiagnosticSection {
  return createJsonIssueReportSection('worker_state', 'Worker State', worker, {
    summary: `Worker mode: ${worker.mode}; endpoint available: ${
      worker.endpointAvailable ? 'yes' : 'no'
    }.`,
  })
}

export function createWorkspaceStateSection(workspace: unknown): IssueReportDiagnosticSection {
  return createJsonIssueReportSection('workspace_state', 'Workspace State', workspace, {
    summary: isWorkspaceDiagnosticsSummary(workspace)
      ? `${workspace.workspaceCount} workspace(s), active=${workspace.activeWorkspaceId ?? 'none'}.`
      : 'Workspace state unavailable.',
    sensitivity: 'local-paths-optional',
  })
}

function isWorkspaceDiagnosticsSummary(
  value: unknown,
): value is { workspaceCount: number; activeWorkspaceId: string | null } {
  return (
    !!value &&
    typeof value === 'object' &&
    'workspaceCount' in value &&
    typeof (value as { workspaceCount?: unknown }).workspaceCount === 'number'
  )
}

export function createAgentStateSection(agent: unknown): IssueReportDiagnosticSection {
  return createJsonIssueReportSection('agent_state', 'Agent State', agent, {
    summary: isAgentDiagnosticsSummary(agent)
      ? `Default provider: ${agent.defaultProvider}; model: ${agent.defaultModel ?? 'default'}.`
      : 'Agent state unavailable.',
  })
}

function isAgentDiagnosticsSummary(
  value: unknown,
): value is { defaultProvider: string; defaultModel: string | null } {
  return !!value && typeof value === 'object' && 'defaultProvider' in value
}

export function createProcessSnapshotSection(
  snapshot: PerformanceDiagnosticsSnapshotResult,
): IssueReportDiagnosticSection {
  return createJsonIssueReportSection(
    'process_snapshot',
    'Process Snapshot',
    summarizeProcessSnapshot(snapshot),
    {
      summary: `${snapshot.processTree.status} process tree with ${snapshot.processTree.sampledProcessCount} sampled process(es).`,
      github: 'excerpt',
    },
  )
}

function summarizeProcessSnapshot(snapshot: PerformanceDiagnosticsSnapshotResult) {
  return {
    capturedAt: snapshot.capturedAt,
    platform: snapshot.platform,
    arch: snapshot.arch,
    mainPid: snapshot.mainPid,
    processTree: snapshot.processTree,
    processSummary: snapshot.processSummary,
    processes: snapshot.processes.slice(0, 40).map(processInfo => ({
      pid: processInfo.pid,
      parentPid: processInfo.parentPid,
      name: processInfo.name,
      kind: processInfo.kind,
      scope: processInfo.scope,
      workingSetBytes: processInfo.workingSetBytes,
      privateBytes: processInfo.privateBytes,
      threadCount: processInfo.threadCount,
      cpuUserTimeMs: processInfo.cpuUserTimeMs,
      cpuKernelTimeMs: processInfo.cpuKernelTimeMs,
      commandLine: processInfo.commandLine
        ? {
            present: true,
            length: processInfo.commandLine.length,
            tokenCount: processInfo.commandLine.trim().split(/\s+/u).filter(Boolean).length,
          }
        : null,
    })),
    processRowsTruncated: snapshot.processes.length > 40,
    electronMetrics: snapshot.electronMetrics,
    notes: snapshot.notes,
  }
}

export function createLogSection(excerpt: IssueReportLogExcerpt): IssueReportDiagnosticSection {
  return {
    id: `log_${excerpt.fileName.replace(/[^a-z0-9]+/giu, '_').replace(/^_|_$/gu, '')}`,
    title: `Log: ${excerpt.fileName}`,
    status: excerpt.status === 'read_failed' ? 'unavailable' : 'available',
    sensitivity: 'redacted',
    github: 'excerpt',
    contentKind: 'log',
    summary: `${excerpt.fileName}: ${excerpt.status}, ${excerpt.includedBytes}/${
      excerpt.originalBytes ?? 'unknown'
    } bytes included${excerpt.truncated ? ', tail truncated' : ''}.`,
    content: formatLogExcerpt(excerpt),
    error: excerpt.error ?? null,
    metadata: {
      originalBytes: excerpt.originalBytes,
      includedBytes: excerpt.includedBytes,
      omittedBytes: excerpt.omittedBytes,
      truncated: excerpt.truncated,
    },
  }
}

function formatLogExcerpt(excerpt: IssueReportLogExcerpt): string {
  const header = [
    `file=${excerpt.fileName}`,
    `status=${excerpt.status}`,
    `originalBytes=${excerpt.originalBytes ?? 'unknown'}`,
    `includedBytes=${excerpt.includedBytes}`,
    `omittedBytes=${excerpt.omittedBytes}`,
    `truncated=${excerpt.truncated ? 'yes' : 'no'}`,
    `tail=${excerpt.tail ? 'yes' : 'no'}`,
    `path=${excerpt.path ?? 'unknown'}`,
    excerpt.error ? `error=${excerpt.error}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join('\n')

  if (excerpt.status !== 'available' || excerpt.content.trim().length === 0) {
    return `${header}\n\n${excerpt.status === 'empty' ? 'No recent entries.' : 'No log content.'}`
  }

  return `${header}\n\n${excerpt.content.trimEnd()}`
}
