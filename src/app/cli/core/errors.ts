import type { CliIo } from './io'
import type { OptionSpec } from './command'
export class CliError extends Error {
  constructor(
    public code: string,
    public exitCode: number,
    message: string,
    public hint?: string,
    public details?: unknown,
  ) {
    super(message)
  }
}
export function usage(message: string, hint?: string): never {
  throw new CliError('cli.usage', 2, message, hint)
}
export function printError(io: CliIo, error: CliError, json: boolean) {
  const profiles =
    error.details &&
    typeof error.details === 'object' &&
    'profiles' in error.details &&
    Array.isArray(error.details.profiles)
      ? error.details.profiles
      : []
  const searched = profiles.length ? `  searched profiles: ${profiles.join(', ')}\n` : ''
  io.stderr.write(
    io.stderr.isTTY && !json
      ? `error[${error.code}]: ${error.message}\n${searched}${error.hint ? `  hint: ${error.hint}\n` : ''}`
      : `${JSON.stringify({ error: { code: error.code, message: error.message, hint: error.hint, details: error.details } })}\n`,
  )
}

export function choiceMessage(field: string, value: unknown, choices: readonly unknown[]) {
  return `Invalid ${field} ${JSON.stringify(value) ?? 'undefined'}: expected one of ${choices.map(choice => (choice === '' ? '""' : String(choice))).join(', ') || 'none'}`
}

export function inputErrorMessage(id: string, message?: string) {
  return `Invalid input for ${id}: ${message && message !== 'The request was invalid.' ? message : 'check the input fields against "opencove api schema ' + id + '"'}`
}

function inputAtPath(input: unknown, path: unknown[]): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value && typeof value === 'object' && Object.hasOwn(value, String(key))
        ? (value as Record<string, unknown>)[String(key)]
        : undefined,
    input,
  )
}

/** Recover choice diagnostics only after the server has rejected the request. */
export function inputChoiceIssues(input: unknown, options: Record<string, OptionSpec> = {}) {
  return Object.values(options).flatMap(spec => {
    if (!spec.inputPath || !spec.choices || typeof spec.choices === 'function') {
      return []
    }
    const path = spec.inputPath.split('.')
    const received = inputAtPath(input, path)
    const value =
      typeof received === 'string' && spec.normalize ? spec.normalize(received) : received
    return received === null || received === undefined || spec.choices.includes(String(value))
      ? []
      : [{ path, code: 'invalid_value', values: spec.choices, received }]
  })
}

export function validationError(
  id: string,
  issues: unknown[],
  exitCode = 2,
  code = 'cli.usage',
  input?: unknown,
) {
  const summaries = issues.slice(0, 3).map(issue => {
    const item = issue && typeof issue === 'object' ? (issue as Record<string, unknown>) : {}
    const path = Array.isArray(item.path) ? item.path.join('.') : 'input'
    const choices = Array.isArray(item.values)
      ? item.values
      : Array.isArray(item.options)
        ? item.options
        : undefined
    if (choices) {
      const received = Object.hasOwn(item, 'received')
        ? item.received
        : Object.hasOwn(item, 'input')
          ? item.input
          : inputAtPath(input, Array.isArray(item.path) ? item.path : [])
      return choiceMessage(path || 'input', received, choices)
    }
    const message =
      item.code === 'invalid_type' && typeof item.expected === 'string'
        ? `expected ${item.expected}`
        : typeof item.message === 'string' && item.message !== 'The request was invalid.'
          ? item.message
          : 'invalid value'
    return `${path || 'input'}: ${message}`
  })
  return new CliError(
    code,
    exitCode,
    summaries.length && summaries.every(summary => summary.startsWith('Invalid '))
      ? summaries.join('; ')
      : inputErrorMessage(id, summaries.join('; ') || undefined),
    issues
      .map(issue =>
        issue && typeof issue === 'object' && 'hint' in issue ? issue.hint : undefined,
      )
      .find((hint): hint is string => typeof hint === 'string'),
    { issues },
  )
}
