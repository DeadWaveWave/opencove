import type {
  IssueReportIncludedDiagnostics,
  IssueReportKind,
  PrepareIssueReportInput,
} from '@shared/contracts/dto'

const MAX_REPORT_MARKDOWN_CHARS = 80_000
const MAX_GITHUB_BODY_CHARS = 1_900

export interface IssueReportDiagnosticsSnapshot {
  app: unknown
  update: unknown | null
  worker: unknown | null
  agent: unknown | null
  logs: Array<{ label: string; content: string | null; error?: string | null }>
}

export interface BuildIssueReportDocumentInput {
  reportId: string
  createdAt: string
  request: Required<Pick<PrepareIssueReportInput, 'kind'>> &
    Pick<PrepareIssueReportInput, 'title' | 'description' | 'includeLocalPaths' | 'context'>
  diagnostics: IssueReportDiagnosticsSnapshot
  knownPathsToRedact: string[]
}

export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[truncated ${
    value.length - maxChars
  } characters]`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSensitiveText(
  value: string,
  options: { knownPaths?: string[] } = {},
): string {
  let redacted = value

  for (const rawPath of options.knownPaths ?? []) {
    const normalized = rawPath.trim()
    if (normalized.length < 4) {
      continue
    }

    redacted = redacted.replace(new RegExp(escapeRegExp(normalized), 'gi'), '[local-path]')
  }

  redacted = redacted
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s"'`]+/giu, '$1[redacted]')
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*)[^\s]+/giu,
      '$1[redacted]',
    )
    .replace(
      /"([^"]*(?:token|secret|password|api[_-]?key|access[_-]?key)[^"]*)"\s*:\s*"[^"]*"/giu,
      '"$1":"[redacted]"',
    )
    .replace(/\b((?:token|secret|password|api[_-]?key|access[_-]?key)=)[^&\s]+/giu, '$1[redacted]')

  return redacted
}

export function defaultIssueReportTitle(kind: IssueReportKind): string {
  if (kind === 'run_agent_failed') {
    return 'Run Agent failed'
  }

  if (kind === 'app_error') {
    return 'OpenCove app issue'
  }

  return 'OpenCove issue'
}

function formatJsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
}

function formatLogBlock(content: string | null, error?: string | null): string {
  if (error) {
    return `Unavailable: ${error}`
  }

  if (!content || content.trim().length === 0) {
    return 'No recent entries.'
  }

  return `\`\`\`text\n${content.trimEnd()}\n\`\`\``
}

function normalizeReportTitle(input: BuildIssueReportDocumentInput): string {
  const title = input.request.title?.trim()
  return title && title.length > 0 ? title : defaultIssueReportTitle(input.request.kind)
}

function normalizeDescription(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : '_No description provided._'
}

function formatContext(input: BuildIssueReportDocumentInput): string {
  const context = input.request.context
  if (!context) {
    return '- Active workspace: not provided'
  }

  const includePaths = input.request.includeLocalPaths === true
  return [
    `- Active workspace: ${context.activeWorkspaceName?.trim() || 'not provided'}`,
    `- Active workspace path: ${
      includePaths && context.activeWorkspacePath?.trim()
        ? context.activeWorkspacePath.trim()
        : '[hidden]'
    }`,
    `- Active space: ${context.activeSpaceName?.trim() || 'not provided'}`,
    `- Active space path: ${
      includePaths && context.activeSpacePath?.trim() ? context.activeSpacePath.trim() : '[hidden]'
    }`,
  ].join('\n')
}

export function buildIssueReportMarkdown(input: BuildIssueReportDocumentInput): string {
  const title = normalizeReportTitle(input)
  const description = normalizeDescription(input.request.description)
  const sections = [
    `# ${title}`,
    `- Report ID: ${input.reportId}`,
    `- Created: ${input.createdAt}`,
    `- Kind: ${input.request.kind}`,
    '',
    '## What Happened',
    description,
    '',
    '## Current Context',
    formatContext(input),
    '',
    '## App',
    formatJsonBlock(input.diagnostics.app),
    '',
    '## Update',
    formatJsonBlock(input.diagnostics.update ?? { status: 'unavailable' }),
    '',
    '## Worker',
    formatJsonBlock(input.diagnostics.worker ?? { status: 'unavailable' }),
    '',
    '## Agent',
    formatJsonBlock(input.diagnostics.agent ?? { status: 'unavailable' }),
    '',
    '## Logs',
    ...input.diagnostics.logs.flatMap(log => [
      `### ${log.label}`,
      formatLogBlock(log.content, log.error),
      '',
    ]),
  ]

  const raw = sections.join('\n')
  return truncateText(
    redactSensitiveText(raw, { knownPaths: input.knownPathsToRedact }),
    MAX_REPORT_MARKDOWN_CHARS,
  )
}

export function buildGitHubIssueUrl(input: {
  title: string
  description: string
  reportId: string
  reportFileName: string
}): string {
  const params = new URLSearchParams()
  params.set('title', input.title)
  params.set(
    'body',
    truncateText(
      [
        '### Summary',
        input.description.trim() || '_No description provided._',
        '',
        '### Diagnostic report',
        `OpenCove generated \`${input.reportFileName}\` locally for this issue.`,
        'Please review the file and paste or attach the relevant parts here.',
        '',
        `Report ID: ${input.reportId}`,
      ].join('\n'),
      MAX_GITHUB_BODY_CHARS,
    ),
  )

  return `https://github.com/DeadWaveWave/opencove/issues/new?${params.toString()}`
}

export function resolveIncludedDiagnostics(
  includeLocalPaths: boolean,
): IssueReportIncludedDiagnostics {
  return {
    system: true,
    worker: true,
    agent: true,
    logs: true,
    localPaths: includeLocalPaths,
  }
}
