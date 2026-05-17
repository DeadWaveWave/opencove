import { appendFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type {
  AgentLaunchMode,
  AgentProviderId,
  RuntimeDiagnosticsDetailValue,
  RuntimeDiagnosticsLogInput,
} from '../../../shared/contracts/dto'

const AGENT_LAUNCH_DIAGNOSTICS_ENABLED =
  process.env['OPENCOVE_AGENT_LAUNCH_DIAGNOSTICS'] === '1' ||
  process.env['OPENCOVE_TERMINAL_DIAGNOSTICS'] === '1'
const VALUE_ARG_FLAGS = new Set([
  '--ask-for-approval',
  '--hostname',
  '--model',
  '--port',
  '--sandbox',
])
const SENSITIVE_VALUE_ARG_FLAGS = new Set([
  '--prompt',
  '--prompt-interactive',
  '--resume',
  '--session',
])
const KNOWN_POSITIONAL_ARGS = new Set(['.', 'resume'])

function truncate(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}...<truncated:${value.length}>`
}

function appendRuntimeDiagnosticsFile(line: string): void {
  const userDataDir = process.env['OPENCOVE_USER_DATA_DIR']?.trim()
  if (!userDataDir) {
    return
  }

  try {
    const filePath = resolve(userDataDir, 'logs', 'runtime-diagnostics.log')
    mkdirSync(dirname(filePath), { recursive: true })
    appendFileSync(filePath, `${line}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // Diagnostics logging must never affect app runtime behavior.
  }
}

function writeAgentLaunchDiagnosticsLine(payload: RuntimeDiagnosticsLogInput): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...payload,
  })
  const stream = payload.level === 'error' ? process.stderr : process.stdout
  stream.write(`[opencove-runtime-diagnostics] ${line}\n`)
  appendRuntimeDiagnosticsFile(line)
}

function logAgentLaunchDiagnostics(
  level: 'info' | 'error',
  event: string,
  message: string,
  details?: Record<string, RuntimeDiagnosticsDetailValue>,
): void {
  writeAgentLaunchDiagnosticsLine({
    source: 'main-app',
    level,
    event: `agent-launch:${event}`,
    message,
    ...(details ? { details } : {}),
  })
}

function summarizePath(path: string | null | undefined): string | null {
  if (!path) {
    return null
  }

  return truncate(path, 320)
}

function summarizeEnv(
  env: NodeJS.ProcessEnv | undefined,
): Record<string, RuntimeDiagnosticsDetailValue> {
  if (!env) {
    return {
      envProvided: false,
      envKeyCount: null,
      envPathLength: null,
      envPathHead: null,
    }
  }

  const pathValue = env.Path ?? env.PATH ?? null
  return {
    envProvided: true,
    envKeyCount: Object.keys(env).length,
    envPathLength: typeof pathValue === 'string' ? pathValue.length : null,
    envPathHead: typeof pathValue === 'string' ? truncate(pathValue, 180) : null,
  }
}

function summarizeArgs(
  provider: AgentProviderId | null,
  mode: AgentLaunchMode | string | null,
  args: string[],
): string {
  const summary: string[] = []
  let previousFlag: string | null = null
  let optionParsingTerminated = false

  for (const [index, arg] of args.entries()) {
    if (previousFlag && SENSITIVE_VALUE_ARG_FLAGS.has(previousFlag)) {
      summary.push(`<redacted:${previousFlag}:len=${arg.length}>`)
      previousFlag = null
      continue
    }

    if (previousFlag && VALUE_ARG_FLAGS.has(previousFlag)) {
      summary.push(truncate(arg, 80))
      previousFlag = null
      continue
    }

    if (arg === '--') {
      summary.push(arg)
      previousFlag = null
      optionParsingTerminated = true
      continue
    }

    if (optionParsingTerminated) {
      if (provider === 'codex' && mode === 'new') {
        summary.push(`<redacted:codex-prompt:index=${index}:len=${arg.length}>`)
        continue
      }

      summary.push(`<arg:index=${index}:len=${arg.length}>`)
      continue
    }

    if (arg.startsWith('-')) {
      summary.push(arg)
      previousFlag = arg
      continue
    }

    previousFlag = null
    if (KNOWN_POSITIONAL_ARGS.has(arg)) {
      summary.push(arg)
      continue
    }

    if (provider === 'codex' && mode === 'new') {
      summary.push(`<redacted:codex-prompt:index=${index}:len=${arg.length}>`)
      continue
    }

    summary.push(`<arg:index=${index}:len=${arg.length}>`)
  }

  return JSON.stringify(summary)
}

export function describeAgentLaunchCommand(input: {
  provider: AgentProviderId | null
  mode: AgentLaunchMode | string | null
  command: string
  args: string[]
  cwd?: string | null
  executablePathOverride?: string | null
  env?: NodeJS.ProcessEnv
}): Record<string, RuntimeDiagnosticsDetailValue> {
  return {
    provider: input.provider,
    mode: input.mode,
    cwd: summarizePath(input.cwd),
    command: summarizePath(input.command),
    commandName: basename(input.command),
    argCount: input.args.length,
    argsShape: summarizeArgs(input.provider, input.mode, input.args),
    argsContainFullAuto: input.args.includes('--full-auto'),
    argsContainCodexSandbox: input.args.includes('--sandbox'),
    argsContainCodexAskApproval: input.args.includes('--ask-for-approval'),
    argsContainCodexBypass: input.args.includes('--dangerously-bypass-approvals-and-sandbox'),
    executablePathOverride: summarizePath(input.executablePathOverride),
    executablePathOverridePresent: !!input.executablePathOverride,
    ...summarizeEnv(input.env),
  }
}

export function describeAgentLaunchError(
  error: unknown,
): Record<string, RuntimeDiagnosticsDetailValue> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: truncate(error.message, 500),
      errorStack: error.stack ? truncate(error.stack, 1200) : null,
    }
  }

  return {
    errorName: null,
    errorMessage: truncate(String(error), 500),
    errorStack: null,
  }
}

export function logAgentLaunchInfo(
  event: string,
  message: string,
  details?: Record<string, RuntimeDiagnosticsDetailValue>,
): void {
  if (!AGENT_LAUNCH_DIAGNOSTICS_ENABLED) {
    return
  }

  logAgentLaunchDiagnostics('info', event, message, details)
}

export function logAgentLaunchError(
  event: string,
  message: string,
  details?: Record<string, RuntimeDiagnosticsDetailValue>,
): void {
  if (!AGENT_LAUNCH_DIAGNOSTICS_ENABLED) {
    return
  }

  logAgentLaunchDiagnostics('error', event, message, details)
}
