import type {
  IssueReportIncludedDiagnostics,
  IssueReportKind,
  PrepareIssueReportInput,
} from '@shared/contracts/dto'

const SANITIZER_VERSION = 2
const MAX_REPORT_MARKDOWN_CHARS = 320_000
const MAX_GITHUB_BODY_CHARS = 6_000
const MAX_GITHUB_URL_CHARS = 7_500
const GITHUB_BODY_MIN_CHARS = 1_600

export type IssueReportDiagnosticSectionSensitivity = 'safe' | 'redacted' | 'local-paths-optional'
export type IssueReportDiagnosticSectionGithubMode = 'summary' | 'excerpt' | 'omit'
export type IssueReportDiagnosticSectionStatus = 'available' | 'unavailable'
export type IssueReportDiagnosticContentKind = 'json' | 'text' | 'log'

export interface IssueReportLogExcerpt {
  fileName: string
  path: string | null
  status: 'available' | 'missing' | 'empty' | 'read_failed'
  content: string
  originalBytes: number | null
  includedBytes: number
  omittedBytes: number
  truncated: boolean
  tail: boolean
  error?: string | null
}

export interface IssueReportDiagnosticSection {
  id: string
  title: string
  status: IssueReportDiagnosticSectionStatus
  sensitivity: IssueReportDiagnosticSectionSensitivity
  github: IssueReportDiagnosticSectionGithubMode
  contentKind: IssueReportDiagnosticContentKind
  summary?: string | null
  content: unknown
  error?: string | null
  metadata?: {
    originalBytes?: number | null
    includedBytes?: number | null
    omittedBytes?: number | null
    truncated?: boolean
  }
}

export interface BuildIssueReportDocumentInput {
  reportId: string
  createdAt: string
  request: Required<Pick<PrepareIssueReportInput, 'kind'>> &
    Pick<PrepareIssueReportInput, 'title' | 'description' | 'includeLocalPaths' | 'context'>
  sections: IssueReportDiagnosticSection[]
  knownPathsToRedact: string[]
}

export interface BuiltIssueReportDocument {
  markdown: string
  githubBody: string
}

export function truncateText(value: string, maxChars: number, marker = 'truncated'): string {
  if (value.length <= maxChars) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxChars - 80)).trimEnd()}\n\n[truncated ${
    value.length - maxChars
  } characters: ${marker}]`
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

    const forwardSlashPath = normalized.replace(/\\/g, '/')
    if (forwardSlashPath !== normalized) {
      redacted = redacted.replace(new RegExp(escapeRegExp(forwardSlashPath), 'gi'), '[local-path]')
    }
  }

  redacted = redacted
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s"'`,;]+/giu, '$1[redacted]')
    .replace(/\b(authorization\s*:\s*basic\s+)[^\s"'`,;]+/giu, '$1[redacted]')
    .replace(/\b((?:cookie|set-cookie)\s*:\s*)[^\r\n]+/giu, '$1[redacted]')
    .replace(/(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/giu, '$1[redacted]@')
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|ACCESS_KEY|PRIVATE_KEY|SESSION|JWT|AUTH)[A-Z0-9_]*\s*=\s*)[^\s]+/giu,
      '$1[redacted]',
    )
    .replace(
      /"([^"]*(?:token|secret|password|pass|api[_-]?key|access[_-]?key|private[_-]?key|session|jwt|auth)[^"]*)"\s*:\s*"[^"]*"/giu,
      '"$1":"[redacted]"',
    )
    .replace(
      /'([^']*(?:token|secret|password|pass|api[_-]?key|access[_-]?key|private[_-]?key|session|jwt|auth)[^']*)'\s*:\s*'[^']*'/giu,
      "'$1':'[redacted]'",
    )
    .replace(
      /\b((?:token|secret|password|pass|api[_-]?key|access[_-]?key|private[_-]?key|session|jwt|auth)=)[^&\s]+/giu,
      '$1[redacted]',
    )
    .replace(/\b(sk-[A-Za-z0-9_-]{20,})\b/gu, '[redacted-openai-key]')
    .replace(/\b(ghp_[A-Za-z0-9_]{20,})\b/gu, '[redacted-github-token]')
    .replace(/\b(github_pat_[A-Za-z0-9_]{20,})\b/gu, '[redacted-github-token]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
      '[redacted-jwt]',
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
      '[redacted-private-key]',
    )

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

function stringifySectionContent(section: IssueReportDiagnosticSection): string {
  if (section.contentKind === 'json') {
    return JSON.stringify(section.content, null, 2)
  }

  if (typeof section.content === 'string') {
    return section.content
  }

  return JSON.stringify(section.content, null, 2)
}

function formatTextBlock(value: string): string {
  if (value.trim().length === 0) {
    return 'No content.'
  }

  return `\`\`\`text\n${value.trimEnd()}\n\`\`\``
}

function formatSectionContent(section: IssueReportDiagnosticSection): string {
  if (section.status === 'unavailable') {
    return `Unavailable${section.error ? `: ${section.error}` : '.'}`
  }

  if (section.contentKind === 'json') {
    return formatJsonBlock(section.content)
  }

  return formatTextBlock(stringifySectionContent(section))
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

function buildDiagnosticsManifest(input: BuildIssueReportDocumentInput): unknown {
  return {
    sanitizerVersion: SANITIZER_VERSION,
    localPathsIncluded: input.request.includeLocalPaths === true,
    sections: input.sections.map(section => ({
      id: section.id,
      title: section.title,
      status: section.status,
      sensitivity: section.sensitivity,
      github: section.github,
      contentKind: section.contentKind,
      summary: section.summary ?? null,
      error: section.error ?? null,
      originalBytes: section.metadata?.originalBytes ?? null,
      includedBytes: section.metadata?.includedBytes ?? null,
      omittedBytes: section.metadata?.omittedBytes ?? null,
      truncated: section.metadata?.truncated ?? false,
    })),
  }
}

function buildFullMarkdown(input: BuildIssueReportDocumentInput): string {
  const title = normalizeReportTitle(input)
  const description = normalizeDescription(input.request.description)
  const sections = [
    `# ${title}`,
    `- Report ID: ${input.reportId}`,
    `- Created: ${input.createdAt}`,
    `- Kind: ${input.request.kind}`,
    `- Sanitizer version: ${SANITIZER_VERSION}`,
    `- Local paths included: ${input.request.includeLocalPaths === true ? 'yes' : 'no'}`,
    '',
    '## What Happened',
    description,
    '',
    '## Current Context',
    formatContext(input),
    '',
    '## Diagnostics Manifest',
    formatJsonBlock(buildDiagnosticsManifest(input)),
    '',
    ...input.sections.flatMap(section => [
      `## ${section.title}`,
      section.summary ? `_${section.summary}_\n` : '',
      formatSectionContent(section),
      '',
    ]),
  ]

  return sections.join('\n')
}

function formatGithubSection(section: IssueReportDiagnosticSection): string[] {
  if (section.github === 'omit') {
    return []
  }

  const lines = [`#### ${section.title}`]
  if (section.summary) {
    lines.push(section.summary)
  }

  if (section.status === 'unavailable') {
    lines.push(`Unavailable${section.error ? `: ${section.error}` : '.'}`)
    return lines
  }

  if (section.github === 'summary') {
    if (!section.summary) {
      lines.push(formatSectionContent(section))
    }
    return lines
  }

  const rawContent = stringifySectionContent(section)
  const metadata = section.metadata
  if (metadata) {
    lines.push(
      [
        `originalBytes=${metadata.originalBytes ?? 'unknown'}`,
        `includedBytes=${metadata.includedBytes ?? 'unknown'}`,
        `omittedBytes=${metadata.omittedBytes ?? 0}`,
        `truncated=${metadata.truncated === true ? 'yes' : 'no'}`,
      ].join(', '),
    )
  }

  lines.push(formatTextBlock(truncateText(rawContent, 1_800, `${section.id}:github-excerpt`)))
  return lines
}

function buildGithubBody(input: BuildIssueReportDocumentInput): string {
  const description = normalizeDescription(input.request.description)
  const manifest = buildDiagnosticsManifest(input)
  const lines = [
    '### Summary',
    description,
    '',
    '### Diagnostic Summary',
    `Report ID: ${input.reportId}`,
    `Created: ${input.createdAt}`,
    `Kind: ${input.request.kind}`,
    `Local paths included: ${input.request.includeLocalPaths === true ? 'yes' : 'no'}`,
    `Sanitizer version: ${SANITIZER_VERSION}`,
    '',
    '### Current Context',
    formatContext(input),
    '',
    '### Runtime Diagnostics',
    ...input.sections.flatMap(section => [...formatGithubSection(section), '']),
    '### Diagnostics Manifest',
    formatJsonBlock(manifest),
    '',
    'The full generated report is saved locally with larger log excerpts.',
  ]

  return truncateText(lines.join('\n'), MAX_GITHUB_BODY_CHARS, 'github-body-budget')
}

export function buildIssueReportDocument(
  input: BuildIssueReportDocumentInput,
): BuiltIssueReportDocument {
  const markdown = truncateText(
    redactSensitiveText(buildFullMarkdown(input), { knownPaths: input.knownPathsToRedact }),
    MAX_REPORT_MARKDOWN_CHARS,
    'full-report-budget',
  )
  const githubBody = redactSensitiveText(buildGithubBody(input), {
    knownPaths: input.knownPathsToRedact,
  })

  return {
    markdown,
    githubBody,
  }
}

export function buildIssueReportMarkdown(input: BuildIssueReportDocumentInput): string {
  return buildIssueReportDocument(input).markdown
}

export function buildGitHubIssueUrl(input: { title: string; body: string }): string {
  const params = new URLSearchParams()
  params.set('title', input.title)
  params.set('body', input.body)

  let url = `https://github.com/DeadWaveWave/opencove/issues/new?${params.toString()}`
  if (url.length <= MAX_GITHUB_URL_CHARS) {
    return url
  }

  let budget = Math.max(
    GITHUB_BODY_MIN_CHARS,
    input.body.length - (url.length - MAX_GITHUB_URL_CHARS) - 200,
  )
  while (budget >= GITHUB_BODY_MIN_CHARS) {
    const nextParams = new URLSearchParams()
    nextParams.set('title', input.title)
    nextParams.set('body', truncateText(input.body, budget, 'github-url-budget'))
    url = `https://github.com/DeadWaveWave/opencove/issues/new?${nextParams.toString()}`
    if (url.length <= MAX_GITHUB_URL_CHARS) {
      return url
    }
    budget = Math.floor(budget * 0.8)
  }

  const fallbackParams = new URLSearchParams()
  fallbackParams.set('title', input.title)
  fallbackParams.set('body', truncateText(input.body, GITHUB_BODY_MIN_CHARS, 'github-url-budget'))
  return `https://github.com/DeadWaveWave/opencove/issues/new?${fallbackParams.toString()}`
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
