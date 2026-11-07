import type { CliIo } from './io'
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

export function validationError(id: string, issues: unknown[], exitCode = 2, code = 'cli.usage') {
  const summaries = issues.slice(0, 3).map(issue => {
    const item = issue && typeof issue === 'object' ? (issue as Record<string, unknown>) : {}
    const path = Array.isArray(item.path) ? item.path.join('.') : 'input'
    const message =
      item.code === 'invalid_type' && typeof item.expected === 'string'
        ? `expected ${item.expected}`
        : typeof item.message === 'string'
          ? item.message
          : 'invalid value'
    return `${path || 'input'}: ${message}`
  })
  return new CliError(
    code,
    exitCode,
    `Invalid input for ${id}: ${summaries.join('; ') || 'invalid value'}`,
    issues
      .map(issue =>
        issue && typeof issue === 'object' && 'hint' in issue ? issue.hint : undefined,
      )
      .find((hint): hint is string => typeof hint === 'string'),
    { issues },
  )
}
