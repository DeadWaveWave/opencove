import { parseArgs, type ParseArgsConfig } from 'node:util'
import type { Command, OptionSpec } from './command'
import type { CliIo } from './io'
import { CliError, usage } from './errors'
export const globals: Record<string, OptionSpec> = {
  endpoint: {
    type: 'string',
    valueName: 'url',
    description: 'Connect to this Control Surface URL',
  },
  token: { type: 'string', valueName: 'token', description: 'Authenticate with this bearer token' },
  'user-data': { type: 'string', valueName: 'dir', description: 'Use this profile directory' },
  timeout: {
    type: 'number',
    valueName: 'ms',
    description: 'Set the request timeout in milliseconds (default: 20000)',
  },
  pretty: { type: 'boolean', description: 'Indent JSON output for readability' },
  fields: {
    type: 'string',
    valueName: 'a,b,...',
    description: 'Select query result fields; dot paths are supported',
  },
  output: { type: 'string', description: 'Choose JSON (default) or a supported table layout' },
  help: { type: 'boolean', description: 'Show help for this command or group' },
  version: { type: 'boolean', description: 'Print the CLI version' },
}
export function commandHelpHint(path: string[]) {
  return `Run "opencove${path.length ? ' ' + path.join(' ') : ''} --help" to see its options.`
}
export function suggest(value: string, choices: string[]): string {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const old = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + Number(a[i - 1] !== b[j - 1]))
        prev = old
      }
    }
    return row[b.length]
  }
  const prefixes = choices.filter(c => c.startsWith(value))
  const best =
    prefixes.length === 1
      ? prefixes[0]
      : [...choices].sort((a, b) => distance(value, a) - distance(value, b))[0]
  return best && (prefixes.length === 1 || distance(value, best) <= 2)
    ? `Did you mean ${best}?`
    : ''
}
export function parse(argv: string[], specs: Record<string, OptionSpec>, path: string[] = []) {
  const options: NonNullable<ParseArgsConfig['options']> = {}
  for (const [key, spec] of Object.entries(specs)) {
    options[key] = {
      type: spec.type === 'boolean' ? 'boolean' : 'string',
      multiple: spec.multiple ?? false,
      ...(key === 'help' ? { short: 'h' } : key === 'output' ? { short: 'o' } : {}),
    }
    if (spec.fileVariant) {
      options[`${key}-file`] = { type: 'string' }
    }
  }
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const flag = /(--[\w-]+|-[a-zA-Z])/.exec(message)?.[1] ?? '--option'
    const hint = commandHelpHint(path)
    const context = `"opencove${path.length ? ' ' + path.join(' ') : ''}"`
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      usage(
        `Unknown option ${flag} for ${context}.`,
        [
          suggest(
            flag,
            Object.keys(options).map(k => `--${k}`),
          ),
          hint,
        ]
          .filter(Boolean)
          .join(' '),
      )
    }
    if (message.includes('ambiguous')) {
      usage(
        `Option ${flag} needs an explicit value for ${context}.`,
        `Use ${flag}=-value or ${flag}-file <path|->. ${hint}`,
      )
    }
    usage(`Invalid or missing value for option ${flag} for ${context}.`, hint)
  }
}
// Consume option values as indivisible tokens before identifying the command path.
export function commandWords(argv: string[], specs: Record<string, OptionSpec>): string[] {
  const words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      words.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('-')) {
      words.push(arg)
      continue
    }
    const key = arg.slice(2).split('=')[0]
    const spec = specs[key] ?? (arg === '-o' ? globals.output : undefined)
    if (!arg.includes('=') && ((spec && spec.type !== 'boolean') || key.endsWith('-file'))) {
      i++
    }
  }
  return words
}
export async function parseCommand(argv: string[], command: Command, io: CliIo) {
  const specs = { ...globals, ...command.options }
  const parsed = parse(argv, specs, command.path)
  const values: Record<string, unknown> = { ...parsed.values }
  for (const [key, spec] of Object.entries(specs)) {
    const file = values[`${key}-file`]
    if (file !== undefined) {
      if (values[key] !== undefined) {
        usage(`Cannot use --${key} and --${key}-file together`)
      }
      try {
        // File variants are consumed in order; stdin is a single stream.
        // eslint-disable-next-line no-await-in-loop
        values[key] = file === '-' ? await io.readStdinText() : await io.readTextFile(String(file))
      } catch (error) {
        if (error instanceof CliError && error.exitCode === 130) {
          throw error
        }
        usage(`Unable to read --${key}-file: ${file}`)
      }
      delete values[`${key}-file`]
    }
    if (values[key] === undefined) {
      if (spec.required && !values.help) {
        usage(
          `Missing required option --${key} for "opencove ${command.path.join(' ')}".`,
          commandHelpHint(command.path),
        )
      }
      continue
    }
    const convert = (value: unknown) => {
      if (spec.type === 'number') {
        const number = Number(value)
        if (!Number.isFinite(number)) {
          usage(`Invalid number for --${key}`)
        }
        return number
      }
      if (spec.type === 'json') {
        try {
          return JSON.parse(String(value))
        } catch {
          usage(`Invalid JSON for --${key}`)
        }
      }
      return value
    }
    values[key] = Array.isArray(values[key])
      ? (values[key] as unknown[]).map(convert)
      : convert(values[key])
  }
  if (values.output !== undefined && !['json', 'table'].includes(String(values.output))) {
    usage('Output must be json or table')
  }
  if (values.timeout !== undefined && Number(values.timeout) <= 0) {
    usage('Timeout must be positive')
  }
  if (
    !values.help &&
    command.targetSpace === 'required' &&
    !['space', 'space-name', 'worker', 'branch', 'path'].some(key => values[key] !== undefined)
  ) {
    usage(
      `Missing required option --space (or another target space option) for "opencove ${command.path.join(' ')}".`,
      commandHelpHint(command.path),
    )
  }
  const positionals = parsed.positionals.slice(command.path.length)
  if (
    !values.help &&
    (positionals.length > (command.positionals?.length ?? 0) ||
      command.positionals?.some((p, i) => p.required && positionals[i] === undefined))
  ) {
    usage('Invalid positional arguments')
  }
  return { options: values, positionals }
}

export function globalArgv(argv: string[], specs: Record<string, OptionSpec>): string[] {
  const result: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      break
    }
    if (!arg.startsWith('-')) {
      continue
    }
    const key = arg === '-o' ? 'output' : arg === '-h' ? 'help' : arg.slice(2).split('=')[0]
    const spec = specs[key]
    if (globals[key]) {
      result.push(arg)
    }
    if (!arg.includes('=') && ((spec && spec.type !== 'boolean') || key.endsWith('-file'))) {
      i++
      if (globals[key] && argv[i] !== undefined) {
        result.push(argv[i])
      }
    }
  }
  return result
}
