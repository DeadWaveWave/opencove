import type {
  PerformanceDiagnosticsProcess,
  PerformanceDiagnosticsProcessSummary,
  PerformanceProcessKind,
  PerformanceProcessScope,
} from '../../../shared/contracts/dto'

export interface RawPerformanceProcessRow {
  pid: number
  parentPid: number | null
  name: string
  commandLine: string
  workingSetBytes: number | null
  privateBytes: number | null
  cpuUserTimeMs: number | null
  cpuKernelTimeMs: number | null
  threadCount: number | null
}

const SECRET_ARGUMENT_PATTERN =
  /((?:--|\/)(?:api[-_]?key|token|auth[-_]?token|access[-_]?token|secret|password|pat)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi
const SECRET_ENV_PATTERN =
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PAT)[A-Z0-9_]*=)("[^"]*"|'[^']*'|\S+)/gi
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g
const MAX_COMMAND_LINE_LENGTH = 360

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function getExecutableStem(name: string): string {
  const normalized = normalizeText(name).replace(/\\/g, '/')
  const fileName = normalized.split('/').filter(Boolean).pop() ?? normalized
  return fileName.endsWith('.exe') ? fileName.slice(0, -4) : fileName
}

function hasExecutableToken(commandLine: string, executableName: string): boolean {
  const escaped = executableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s"'=/\\\\])${escaped}(?:\\.exe)?(?:$|[\\s"'=/\\\\])`, 'i').test(
    commandLine,
  )
}

function classifyExternalAgent(
  nameStem: string,
  commandLine: string,
): PerformanceProcessKind | null {
  if (nameStem === 'codex' || hasExecutableToken(commandLine, 'codex')) {
    return 'external-agent-codex'
  }
  if (nameStem === 'claude' || hasExecutableToken(commandLine, 'claude')) {
    return 'external-agent-claude'
  }
  if (nameStem === 'opencode' || hasExecutableToken(commandLine, 'opencode')) {
    return 'external-agent-opencode'
  }
  if (nameStem === 'gemini' || hasExecutableToken(commandLine, 'gemini')) {
    return 'external-agent-gemini'
  }
  return null
}

export function classifyPerformanceProcess(input: {
  pid: number
  mainPid: number
  name: string
  commandLine: string
}): PerformanceProcessKind {
  const commandLine = normalizeText(input.commandLine)
  const nameStem = getExecutableStem(input.name)

  if (input.pid === input.mainPid) {
    return 'opencove-main'
  }
  if (
    nameStem === 'powershell' &&
    commandLine.includes('get-ciminstance win32_process') &&
    commandLine.includes('select-object processid')
  ) {
    return 'diagnostics-collector'
  }
  if (
    nameStem === 'ps' &&
    commandLine.includes('pid=,ppid=,rss=') &&
    commandLine.includes('args=') &&
    (commandLine.includes('ucomm=') || commandLine.includes('comm='))
  ) {
    return 'diagnostics-collector'
  }
  if (commandLine.includes('profile-terminal-output-stub.mjs')) {
    return 'external-output-stub'
  }

  const externalAgentKind = classifyExternalAgent(nameStem, commandLine)
  if (externalAgentKind) {
    return externalAgentKind
  }
  if (nameStem === 'conhost' || nameStem === 'openconsole') {
    return 'windows-console-host'
  }
  if (
    ['powershell', 'pwsh', 'cmd', 'bash', 'zsh', 'fish', 'sh'].includes(nameStem) ||
    nameStem.endsWith('sh')
  ) {
    return 'external-shell'
  }
  if (
    commandLine.includes('ptyhost') ||
    commandLine.includes('pty-host') ||
    commandLine.includes('ptyhost/entry') ||
    commandLine.includes('ptyhost\\entry')
  ) {
    return 'opencove-pty-host'
  }
  if (commandLine.includes('worker.js') || commandLine.includes('/app/worker/')) {
    return 'opencove-worker'
  }
  if (commandLine.includes('--type=renderer')) {
    return 'opencove-renderer'
  }
  if (commandLine.includes('--type=utility')) {
    return 'opencove-utility'
  }
  if (nameStem === 'node' || nameStem === 'nodejs') {
    return 'node-child'
  }
  return 'other'
}

export function resolvePerformanceProcessScope(
  kind: PerformanceProcessKind,
): PerformanceProcessScope {
  if (
    kind === 'opencove-main' ||
    kind === 'opencove-renderer' ||
    kind === 'opencove-utility' ||
    kind === 'opencove-pty-host' ||
    kind === 'opencove-worker'
  ) {
    return 'opencove'
  }
  if (
    kind === 'external-agent-codex' ||
    kind === 'external-agent-claude' ||
    kind === 'external-agent-opencode' ||
    kind === 'external-agent-gemini' ||
    kind === 'external-output-stub'
  ) {
    return 'external-agent'
  }
  if (kind === 'external-shell' || kind === 'windows-console-host') {
    return 'platform'
  }
  if (kind === 'diagnostics-collector') {
    return 'diagnostics'
  }
  return 'other'
}

export function sanitizeProcessCommandLine(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const redacted = trimmed
    .replace(SECRET_ARGUMENT_PATTERN, '$1[redacted]')
    .replace(SECRET_ENV_PATTERN, '$1[redacted]')
    .replace(OPENAI_KEY_PATTERN, 'sk-[redacted]')

  if (redacted.length <= MAX_COMMAND_LINE_LENGTH) {
    return redacted
  }

  return `${redacted.slice(0, MAX_COMMAND_LINE_LENGTH - 3)}...`
}

export function normalizePerformanceProcessRow(
  row: RawPerformanceProcessRow,
  mainPid: number,
): PerformanceDiagnosticsProcess {
  const kind = classifyPerformanceProcess({
    pid: row.pid,
    mainPid,
    name: row.name,
    commandLine: row.commandLine,
  })

  return {
    pid: row.pid,
    parentPid: row.parentPid,
    name: row.name,
    kind,
    scope: resolvePerformanceProcessScope(kind),
    workingSetBytes: row.workingSetBytes,
    privateBytes: row.privateBytes,
    cpuUserTimeMs: row.cpuUserTimeMs,
    cpuKernelTimeMs: row.cpuKernelTimeMs,
    threadCount: row.threadCount,
    commandLine: sanitizeProcessCommandLine(row.commandLine),
  }
}

export function summarizePerformanceProcesses(
  processes: PerformanceDiagnosticsProcess[],
): PerformanceDiagnosticsProcessSummary[] {
  const byKind = new Map<PerformanceProcessKind, PerformanceDiagnosticsProcessSummary>()

  for (const processRow of processes) {
    const existing = byKind.get(processRow.kind) ?? {
      kind: processRow.kind,
      scope: processRow.scope,
      count: 0,
      workingSetBytes: 0,
      privateBytes: 0,
      threadCount: 0,
    }
    existing.count += 1
    existing.workingSetBytes =
      existing.workingSetBytes === null || processRow.workingSetBytes === null
        ? null
        : existing.workingSetBytes + processRow.workingSetBytes
    existing.privateBytes =
      existing.privateBytes === null || processRow.privateBytes === null
        ? null
        : existing.privateBytes + processRow.privateBytes
    existing.threadCount =
      existing.threadCount === null || processRow.threadCount === null
        ? null
        : existing.threadCount + processRow.threadCount
    byKind.set(processRow.kind, existing)
  }

  return [...byKind.values()].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.kind.localeCompare(b.kind),
  )
}
