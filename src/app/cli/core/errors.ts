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
